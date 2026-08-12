const { randomUUID } = require('crypto');
const { gunzipSync } = require('zlib');
const {
    SNAPSHOT_FORMAT_VERSION,
    buildSnapshot,
    contentHash,
    normalizeGames,
    normalizeHistory,
    selectSnapshotsToDelete,
    sha256,
    snapshotPrefix,
} = require('./core');
const { fetchDatabasePages } = require('./notion-source');

const LATEST_KEY = 'state/latest.json';
const ARTIFACT_NAMES = [
    'games.json.gz',
    'history.json.gz',
    'games.csv',
    'history.csv',
];
const ORPHAN_GRACE_DAYS = 91;
const SNAPSHOT_OBJECT_KEY_PATTERN =
    /^(snapshots\/\d{4}\/\d{2}\/\d{2}\/(\d{8}T\d{9}Z)-[0-9a-f]{12})\/([^/]+)$/;

/** @author yuecheng */
function isManifest(manifest) {
    return Boolean(
        manifest &&
            manifest.formatVersion === SNAPSHOT_FORMAT_VERSION &&
            typeof manifest.contentHash === 'string' &&
            typeof manifest.snapshotCompletedAt === 'string' &&
            manifest.recordCounts &&
            ARTIFACT_NAMES.every(
                (name) =>
                    Number.isInteger(manifest.files?.[name]?.size) &&
                    typeof manifest.files?.[name]?.sha256 === 'string'
            )
    );
}

/** @author yuecheng */
async function readVerifiedObject(storage, key, expected) {
    const object = await storage.getBuffer(key);
    if (!object) return null;
    const valid =
        object.body.length === expected.size &&
        sha256(object.body) === expected.sha256;
    return valid ? object.body : null;
}

/** @author yuecheng */
async function verifyObject(storage, key, expected) {
    return Boolean(await readVerifiedObject(storage, key, expected));
}

/** @author yuecheng */
async function validateSnapshot(storage, pointer) {
    if (
        !pointer ||
        typeof pointer.prefix !== 'string' ||
        typeof pointer.contentHash !== 'string'
    ) {
        return { valid: false, reason: 'invalid latest pointer' };
    }

    const manifestObject = await storage.getBuffer(`${pointer.prefix}/manifest.json`);
    if (!manifestObject) {
        return { valid: false, reason: 'manifest is missing' };
    }

    let manifest;
    try {
        manifest = JSON.parse(manifestObject.body.toString('utf8'));
    } catch {
        return { valid: false, reason: 'manifest is not valid JSON' };
    }
    if (!isManifest(manifest)) {
        return { valid: false, reason: 'manifest schema is invalid' };
    }
    if (
        manifest.contentHash !== pointer.contentHash ||
        (pointer.manifestSha256 &&
            sha256(manifestObject.body) !== pointer.manifestSha256)
    ) {
        return { valid: false, reason: 'manifest does not match latest pointer' };
    }

    const verifiedBodies = {};
    for (const name of ARTIFACT_NAMES) {
        verifiedBodies[name] = await readVerifiedObject(
            storage,
            `${pointer.prefix}/${name}`,
            manifest.files[name]
        );
        if (!verifiedBodies[name]) {
            return { valid: false, reason: `${name} is missing or corrupt` };
        }
    }

    try {
        const games = JSON.parse(
            gunzipSync(verifiedBodies['games.json.gz']).toString('utf8')
        );
        const history = JSON.parse(
            gunzipSync(verifiedBodies['history.json.gz']).toString('utf8')
        );
        if (!Array.isArray(games) || !Array.isArray(history)) {
            return { valid: false, reason: 'JSON artifacts are not arrays' };
        }
        if (
            games.length !== manifest.recordCounts.games ||
            history.length !== manifest.recordCounts.history
        ) {
            return {
                valid: false,
                reason: 'JSON record counts do not match manifest',
            };
        }
        if (contentHash(games, history) !== manifest.contentHash) {
            return {
                valid: false,
                reason: 'JSON business content does not match contentHash',
            };
        }
    } catch {
        return { valid: false, reason: 'compressed JSON cannot be decoded' };
    }

    return { valid: true, manifest };
}

/** @author yuecheng */
function buildRunId(env = process.env) {
    const githubId = env.GITHUB_RUN_ID;
    if (!githubId) return randomUUID();
    return `${githubId}-${env.GITHUB_RUN_ATTEMPT || '1'}`.replaceAll(
        /[^a-zA-Z0-9._-]/g,
        '-'
    );
}

/** @author yuecheng */
async function uploadAndVerify(storage, key, artifact) {
    await storage.put(key, artifact.body, {
        contentType: artifact.contentType,
        contentEncoding: artifact.contentEncoding,
        metadata: { sha256: artifact.sha256 },
    });
    if (!(await verifyObject(storage, key, artifact))) {
        throw new Error(`R2 verification failed after uploading ${key}`);
    }
}

/**
 * Creates a complete immutable snapshot only when the normalized business data
 * differs from the latest valid snapshot.
 *
 * @author yuecheng
 */
async function runBackup({
    config,
    storage,
    fetchPages = fetchDatabasePages,
    now = () => new Date(),
    runId = buildRunId(),
}) {
    const startedAt = now();
    const [gamePages, historyPages] = await Promise.all([
        fetchPages({
            notionApiKey: config.notionApiKey,
            databaseId: config.databaseId,
        }),
        fetchPages({
            notionApiKey: config.notionApiKey,
            databaseId: config.historyDatabaseId,
        }),
    ]);
    const games = normalizeGames(gamePages);
    const history = normalizeHistory(historyPages);
    const hash = contentHash(games, history);

    let latestObject;
    try {
        latestObject = await storage.getJson(LATEST_KEY);
    } catch (error) {
        if (error.code !== 'INVALID_JSON') throw error;
        latestObject = { value: null, etag: error.etag, invalid: true };
    }
    if (latestObject && !latestObject.etag) {
        throw new Error('state/latest.json response is missing its ETag');
    }
    const latest = latestObject?.value;
    let latestValidation = { valid: false, reason: 'no previous snapshot' };
    if (latest) {
        latestValidation = await validateSnapshot(storage, latest);
    }

    if (latest?.contentHash === hash && latestValidation.valid) {
        return {
            status: 'SKIPPED_NO_CHANGE',
            contentHash: hash,
            prefix: latest.prefix,
            recordCounts: { games: games.length, history: history.length },
            integrity: 'verified',
        };
    }

    const completedAt = now();
    const prefix = snapshotPrefix(completedAt, hash, config.timeZone);
    const stagingPrefix = `staging/${runId}`;
    const { artifacts, manifest } = buildSnapshot({
        games,
        history,
        startedAt,
        completedAt,
        hash,
    });
    let cleanupWarning;

    try {
        for (const [name, artifact] of Object.entries(artifacts)) {
            await uploadAndVerify(storage, `${stagingPrefix}/${name}`, artifact);
        }

        for (const name of ARTIFACT_NAMES) {
            await storage.copy(`${stagingPrefix}/${name}`, `${prefix}/${name}`);
            if (!(await verifyObject(storage, `${prefix}/${name}`, artifacts[name]))) {
                throw new Error(`R2 verification failed after copying ${prefix}/${name}`);
            }
        }

        // A snapshot becomes valid only when its manifest is copied last.
        await storage.copy(
            `${stagingPrefix}/manifest.json`,
            `${prefix}/manifest.json`
        );
        const finalValidation = await validateSnapshot(storage, {
            prefix,
            contentHash: hash,
            manifestSha256: artifacts['manifest.json'].sha256,
        });
        if (!finalValidation.valid) {
            throw new Error(`Final snapshot is invalid: ${finalValidation.reason}`);
        }

        const pointer = {
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            prefix,
            contentHash: hash,
            manifestSha256: artifacts['manifest.json'].sha256,
            snapshotCompletedAt: manifest.snapshotCompletedAt,
        };
        const pointerBody = `${JSON.stringify(pointer, null, 2)}\n`;
        try {
            await storage.put(LATEST_KEY, pointerBody, {
                contentType: 'application/json; charset=utf-8',
                ...(latestObject
                    ? { ifMatch: latestObject.etag }
                    : { ifNoneMatch: '*' }),
            });
        } catch (error) {
            if (error.code !== 'CONDITIONAL_WRITE_CONFLICT') throw error;
            const concurrentLatest = await storage.getJson(LATEST_KEY);
            if (concurrentLatest?.value?.contentHash !== hash) {
                throw new Error(
                    'Another backup updated state/latest.json with different content'
                );
            }
        }

        return {
            status:
                latestObject?.invalid || latest?.contentHash === hash
                    ? 'CREATED_REPAIR_SNAPSHOT'
                    : 'CREATED_SNAPSHOT',
            contentHash: hash,
            prefix,
            recordCounts: manifest.recordCounts,
            integrity: 'verified',
        };
    } finally {
        try {
            await storage.deletePrefix(`${stagingPrefix}/`);
        } catch (error) {
            cleanupWarning = error.message;
            console.warn(`Failed to clean staging objects: ${error.message}`);
        }
        if (cleanupWarning) {
            console.warn('The staging lifecycle rule will remove these objects later.');
        }
    }
}

/** @author yuecheng */
function compactTimestampToDate(timestamp) {
    const match = timestamp.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/
    );
    if (!match) return null;
    const [, year, month, day, hour, minute, second, millisecond] = match;
    const value = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`
    );
    if (
        !Number.isFinite(value.getTime()) ||
        value.toISOString().replaceAll(/[-:.]/g, '') !== timestamp
    ) {
        return null;
    }
    return value;
}

/** @author yuecheng */
function snapshotObjectInfo(key) {
    const match = key.match(SNAPSHOT_OBJECT_KEY_PATTERN);
    if (!match) return null;
    const createdAt = compactTimestampToDate(match[2]);
    if (!createdAt) return null;
    return { prefix: match[1], createdAt, fileName: match[3] };
}

/** @author yuecheng */
function partitionOrphanPrefixes(
    orphanPrefixes,
    now,
    graceDays = ORPHAN_GRACE_DAYS
) {
    const cutoff = now.getTime() - graceDays * 24 * 60 * 60 * 1000;
    const expired = [];
    const deferred = [];

    for (const prefix of orphanPrefixes) {
        const info = snapshotObjectInfo(`${prefix}/placeholder`);
        if (info && info.createdAt.getTime() < cutoff) {
            expired.push(prefix);
        } else {
            deferred.push(prefix);
        }
    }

    return { expired: expired.sort(), deferred: deferred.sort() };
}

/** @author yuecheng */
async function readValidSnapshotManifests(storage) {
    const keys = await storage.listKeys('snapshots/');
    const prefixFiles = new Map();
    const snapshots = [];
    const warnings = [];

    for (const key of keys) {
        const info = snapshotObjectInfo(key);
        if (!info) {
            warnings.push(`${key}: unrecognized snapshot object key`);
            continue;
        }
        const files = prefixFiles.get(info.prefix) ?? new Set();
        files.add(info.fileName);
        prefixFiles.set(info.prefix, files);
    }

    const manifestKeys = [...prefixFiles]
        .filter(([, files]) => files.has('manifest.json'))
        .map(([prefix]) => `${prefix}/manifest.json`);

    for (const key of manifestKeys) {
        try {
            const object = await storage.getJson(key);
            if (!isManifest(object?.value)) {
                warnings.push(`${key}: invalid manifest schema`);
                continue;
            }
            const prefix = key.slice(0, -'/manifest.json'.length);
            const validation = await validateSnapshot(storage, {
                prefix,
                contentHash: object.value.contentHash,
            });
            if (!validation.valid) {
                warnings.push(`${key}: ${validation.reason}`);
                continue;
            }
            snapshots.push({
                prefix,
                completedAt: object.value.snapshotCompletedAt,
                manifest: object.value,
            });
        } catch (error) {
            warnings.push(`${key}: ${error.message}`);
        }
    }

    const orphanPrefixes = [...prefixFiles]
        .filter(([, files]) => !files.has('manifest.json'))
        .map(([prefix]) => prefix)
        .sort();

    return { snapshots, warnings, orphanPrefixes };
}

/** @author yuecheng */
async function runAudit({ config, storage, now = new Date() }) {
    const latestObject = await storage.getJson(LATEST_KEY);
    if (!latestObject) {
        throw new Error('state/latest.json does not exist');
    }
    const validation = await validateSnapshot(storage, latestObject.value);
    if (!validation.valid) {
        throw new Error(`Latest snapshot integrity check failed: ${validation.reason}`);
    }

    const { snapshots, warnings, orphanPrefixes } =
        await readValidSnapshotManifests(storage);
    if (warnings.length > 0) {
        throw new Error(
            `Snapshot integrity audit found ${warnings.length} problem(s): ${warnings.join(
                '; '
            )}`
        );
    }
    const prefixesToDelete = selectSnapshotsToDelete(
        snapshots,
        latestObject.value.prefix,
        now,
        { timeZone: config.timeZone }
    );
    const { expired: expiredOrphans, deferred: deferredOrphans } =
        partitionOrphanPrefixes(orphanPrefixes, now);
    let deletedObjects = 0;
    for (const prefix of prefixesToDelete) {
        deletedObjects += await storage.deletePrefix(`${prefix}/`);
    }
    for (const prefix of expiredOrphans) {
        deletedObjects += await storage.deletePrefix(`${prefix}/`);
    }

    return {
        status:
            deferredOrphans.length > 0
                ? 'AUDIT_OK_WITH_DEFERRED_ORPHANS'
                : 'AUDIT_OK',
        latestPrefix: latestObject.value.prefix,
        checkedSnapshots: snapshots.length,
        deletedSnapshots: prefixesToDelete.length,
        deletedOrphanPrefixes: expiredOrphans,
        deferredOrphanPrefixes: deferredOrphans,
        deletedObjects,
        warnings,
    };
}

module.exports = {
    ARTIFACT_NAMES,
    LATEST_KEY,
    ORPHAN_GRACE_DAYS,
    isManifest,
    partitionOrphanPrefixes,
    readVerifiedObject,
    readValidSnapshotManifests,
    runAudit,
    runBackup,
    snapshotObjectInfo,
    validateSnapshot,
    verifyObject,
};
