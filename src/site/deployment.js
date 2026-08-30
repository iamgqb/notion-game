const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { gunzipSync } = require('zlib');
const { contentHash } = require('../backup/core');
const { LATEST_KEY, validateSnapshot } = require('../backup/service');
const { writeSiteData } = require('./export-data');

const SITE_DEPLOYMENT_FORMAT_VERSION = 1;
const SITE_DEPLOYMENT_STATE_KEY = 'state/workers.json';
const DEFAULT_SITE_ROOT = path.resolve(__dirname, '../../site');
const DEFAULT_WRANGLER_CONFIG = path.resolve(__dirname, '../../wrangler.jsonc');

/** @author yuecheng */
function siteFiles(root, directory = root) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return siteFiles(root, absolutePath);
        if (!entry.isFile()) return [];
        return [{
            absolutePath,
            relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
        }];
    });
}

/**
 * Hashes file names and bytes so code, generated data, and Workers deployment
 * configuration all participate in change detection. Files are sorted to keep
 * the result platform-independent.
 *
 * @author yuecheng
 */
function siteDirectoryHash(root = DEFAULT_SITE_ROOT, configPath) {
    const hash = createHash('sha256');
    const files = siteFiles(root);
    const resolvedConfigPath = configPath === undefined &&
        path.resolve(root) === DEFAULT_SITE_ROOT
        ? DEFAULT_WRANGLER_CONFIG
        : configPath;
    if (resolvedConfigPath && !fs.existsSync(resolvedConfigPath)) {
        throw new Error(`Workers configuration does not exist: ${resolvedConfigPath}`);
    }
    if (resolvedConfigPath) {
        files.push({
            absolutePath: resolvedConfigPath,
            relativePath: '@deployment/wrangler.jsonc',
        });
    }
    files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, 'en')
    );
    for (const file of files) {
        hash.update(file.relativePath);
        hash.update('\0');
        hash.update(fs.readFileSync(file.absolutePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

/** @author yuecheng */
function parseCompressedArray(object, label) {
    if (!object) throw new Error(`${label} is missing from the latest snapshot`);
    let value;
    try {
        value = JSON.parse(gunzipSync(object.body).toString('utf8'));
    } catch (error) {
        throw new Error(`${label} cannot be decoded: ${error.message}`, {
            cause: error,
        });
    }
    if (!Array.isArray(value)) {
        throw new Error(`${label} does not contain an array`);
    }
    return value;
}

/**
 * Reads only the latest backup after validating every artifact and manifest.
 * The site never queries Notion during deployment.
 *
 * @author yuecheng
 */
async function readLatestSnapshot(storage) {
    const latestObject = await storage.getJson(LATEST_KEY);
    if (!latestObject?.value) {
        throw new Error(`${LATEST_KEY} does not exist`);
    }
    const pointer = latestObject.value;
    const validation = await validateSnapshot(storage, pointer);
    if (!validation.valid) {
        throw new Error(`Latest snapshot is invalid: ${validation.reason}`);
    }

    const [gamesObject, historyObject] = await Promise.all([
        storage.getBuffer(`${pointer.prefix}/games.json.gz`),
        storage.getBuffer(`${pointer.prefix}/history.json.gz`),
    ]);
    const games = parseCompressedArray(gamesObject, 'games.json.gz');
    const history = parseCompressedArray(historyObject, 'history.json.gz');
    const actualContentHash = contentHash(games, history);
    if (actualContentHash !== pointer.contentHash) {
        throw new Error('Latest snapshot business content hash does not match its pointer');
    }

    return {
        games,
        history,
        prefix: pointer.prefix,
        contentHash: pointer.contentHash,
        snapshotCompletedAt: validation.manifest.snapshotCompletedAt,
    };
}

/** @author yuecheng */
async function readDeploymentState(storage) {
    try {
        return await storage.getJson(SITE_DEPLOYMENT_STATE_KEY);
    } catch (error) {
        if (error.code !== 'INVALID_JSON') throw error;
        return { value: null, etag: error.etag, invalid: true };
    }
}

/** @author yuecheng */
function isCurrentDeploymentState(value) {
    return Boolean(
        value &&
            value.formatVersion === SITE_DEPLOYMENT_FORMAT_VERSION &&
            typeof value.deploymentHash === 'string'
    );
}

/** @author yuecheng */
async function prepareSiteDeployment({
    storage,
    siteRoot = DEFAULT_SITE_ROOT,
    configPath,
    force = false,
}) {
    const snapshot = await readLatestSnapshot(storage);
    const generatedAt = new Date(snapshot.snapshotCompletedAt);
    if (!Number.isFinite(generatedAt.getTime())) {
        throw new Error('Latest snapshot has an invalid completion timestamp');
    }
    const { data } = writeSiteData(
        snapshot.games,
        snapshot.history,
        generatedAt,
        path.join(siteRoot, 'data.js')
    );
    const deploymentHash = siteDirectoryHash(siteRoot, configPath);
    const previousObject = await readDeploymentState(storage);
    const previousHash = isCurrentDeploymentState(previousObject?.value)
        ? previousObject.value.deploymentHash
        : undefined;
    const changed = force || previousHash !== deploymentHash;

    return {
        status: changed ? 'DEPLOY_REQUIRED' : 'SKIPPED_NO_CHANGE',
        changed,
        forced: Boolean(force),
        deploymentHash,
        previousHash: previousHash ?? null,
        sourcePrefix: snapshot.prefix,
        sourceContentHash: snapshot.contentHash,
        snapshotCompletedAt: snapshot.snapshotCompletedAt,
        recordCounts: data.meta.counts,
    };
}

/** @author yuecheng */
async function markSiteDeployed({
    storage,
    deploymentHash,
    sourcePrefix,
    sourceContentHash,
    snapshotCompletedAt,
    siteRoot = DEFAULT_SITE_ROOT,
    configPath,
    deployedAt = new Date(),
    gitSha = null,
}) {
    if (!/^[0-9a-f]{64}$/.test(deploymentHash ?? '')) {
        throw new Error('SITE_DEPLOYMENT_HASH must be a SHA-256 hex digest');
    }
    if (siteDirectoryHash(siteRoot, configPath) !== deploymentHash) {
        throw new Error('Built site changed after deployment preparation');
    }

    const currentObject = await readDeploymentState(storage);
    if (
        isCurrentDeploymentState(currentObject?.value) &&
        currentObject.value.deploymentHash === deploymentHash
    ) {
        return {
            status: 'ALREADY_MARKED',
            deploymentHash,
            sourcePrefix,
        };
    }

    const state = {
        formatVersion: SITE_DEPLOYMENT_FORMAT_VERSION,
        deploymentHash,
        deployedAt: deployedAt.toISOString(),
        gitSha: gitSha || null,
        source: {
            prefix: sourcePrefix,
            contentHash: sourceContentHash,
            snapshotCompletedAt,
        },
    };
    await storage.put(
        SITE_DEPLOYMENT_STATE_KEY,
        `${JSON.stringify(state, null, 2)}\n`,
        {
            contentType: 'application/json; charset=utf-8',
            ...(currentObject
                ? { ifMatch: currentObject.etag }
                : { ifNoneMatch: '*' }),
        }
    );

    return {
        status: 'MARKED_DEPLOYED',
        deploymentHash,
        sourcePrefix,
        deployedAt: state.deployedAt,
    };
}

module.exports = {
    DEFAULT_SITE_ROOT,
    DEFAULT_WRANGLER_CONFIG,
    SITE_DEPLOYMENT_FORMAT_VERSION,
    SITE_DEPLOYMENT_STATE_KEY,
    markSiteDeployed,
    prepareSiteDeployment,
    readLatestSnapshot,
    siteDirectoryHash,
};
