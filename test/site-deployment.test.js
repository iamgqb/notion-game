const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    buildSnapshot,
    contentHash,
} = require('../src/backup/core');
const { LATEST_KEY } = require('../src/backup/service');
const {
    SITE_DEPLOYMENT_STATE_KEY,
    markSiteDeployed,
    prepareSiteDeployment,
    readLatestSnapshot,
    siteDirectoryHash,
} = require('../src/site/deployment');

/** @author yuecheng */
class MemoryStorage {
    constructor() {
        this.objects = new Map();
        this.version = 0;
    }

    async getBuffer(key) {
        const object = this.objects.get(key);
        return object
            ? { body: Buffer.from(object.body), etag: object.etag }
            : null;
    }

    async getJson(key) {
        const object = await this.getBuffer(key);
        if (!object) return null;
        try {
            return {
                value: JSON.parse(object.body.toString('utf8')),
                etag: object.etag,
            };
        } catch (cause) {
            const error = new Error('invalid JSON');
            error.code = 'INVALID_JSON';
            error.etag = object.etag;
            error.cause = cause;
            throw error;
        }
    }

    async put(key, body, options = {}) {
        const existing = this.objects.get(key);
        if (
            (options.ifNoneMatch === '*' && existing) ||
            (options.ifMatch && existing?.etag !== options.ifMatch)
        ) {
            const error = new Error('conflict');
            error.code = 'CONDITIONAL_WRITE_CONFLICT';
            throw error;
        }
        const etag = `"${++this.version}"`;
        this.objects.set(key, { body: Buffer.from(body), etag });
        return { ETag: etag };
    }
}

const games = [{
    name: 'A',
    appid: 1,
    play_time: 120,
    achievement: 0.5,
    buy_time: null,
    status: ['已通关'],
    favorite: true,
}];
const history = [{
    name: 'A',
    appid: 1,
    time: 30,
    date: { start: '2026-08-29', end: null, time_zone: null },
}];

/** @author yuecheng */
async function seedLatestSnapshot(storage) {
    const completedAt = new Date('2026-08-30T01:02:03.456Z');
    const hash = contentHash(games, history);
    const prefix = `snapshots/2026/08/30/20260830T010203456Z-${hash.slice(0, 12)}`;
    const { artifacts } = buildSnapshot({
        games,
        history,
        startedAt: completedAt,
        completedAt,
        hash,
    });
    for (const [name, artifact] of Object.entries(artifacts)) {
        await storage.put(`${prefix}/${name}`, artifact.body);
    }
    await storage.put(
        LATEST_KEY,
        JSON.stringify({
            formatVersion: 1,
            prefix,
            contentHash: hash,
            manifestSha256: artifacts['manifest.json'].sha256,
            snapshotCompletedAt: completedAt.toISOString(),
        })
    );
    return { prefix, hash, completedAt };
}

/** @author yuecheng */
function temporarySite(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-game-site-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<main>site</main>\n');
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log("site");\n');
    fs.writeFileSync(path.join(root, 'styles.css'), 'body { color: black; }\n');
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('站点只在数据或页面文件变化时要求部署', async (t) => {
    const storage = new MemoryStorage();
    const snapshot = await seedLatestSnapshot(storage);
    const siteRoot = temporarySite(t);

    const first = await prepareSiteDeployment({ storage, siteRoot });
    assert.equal(first.status, 'DEPLOY_REQUIRED');
    assert.equal(first.changed, true);
    assert.equal(first.sourcePrefix, snapshot.prefix);
    assert.match(
        fs.readFileSync(path.join(siteRoot, 'data.js'), 'utf8'),
        /window\.NOTION_GAME_DATA/
    );

    const marked = await markSiteDeployed({
        storage,
        deploymentHash: first.deploymentHash,
        sourcePrefix: first.sourcePrefix,
        sourceContentHash: first.sourceContentHash,
        snapshotCompletedAt: first.snapshotCompletedAt,
        siteRoot,
        deployedAt: new Date('2026-08-30T02:00:00.000Z'),
        gitSha: 'abc123',
    });
    assert.equal(marked.status, 'MARKED_DEPLOYED');

    const unchanged = await prepareSiteDeployment({ storage, siteRoot });
    assert.equal(unchanged.status, 'SKIPPED_NO_CHANGE');
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.deploymentHash, first.deploymentHash);

    fs.writeFileSync(path.join(siteRoot, 'styles.css'), 'body { color: red; }\n');
    const codeChanged = await prepareSiteDeployment({ storage, siteRoot });
    assert.equal(codeChanged.status, 'DEPLOY_REQUIRED');
    assert.notEqual(codeChanged.deploymentHash, first.deploymentHash);
});

test('强制部署可覆盖哈希未变化的情况', async (t) => {
    const storage = new MemoryStorage();
    await seedLatestSnapshot(storage);
    const siteRoot = temporarySite(t);
    const first = await prepareSiteDeployment({ storage, siteRoot });
    await storage.put(
        SITE_DEPLOYMENT_STATE_KEY,
        JSON.stringify({ deploymentHash: first.deploymentHash })
    );

    const forced = await prepareSiteDeployment({
        storage,
        siteRoot,
        force: true,
    });
    assert.equal(forced.changed, true);
    assert.equal(forced.forced, true);
    assert.equal(forced.deploymentHash, first.deploymentHash);
});

test('部署状态只接受与当前构建一致的哈希', async (t) => {
    const storage = new MemoryStorage();
    await seedLatestSnapshot(storage);
    const siteRoot = temporarySite(t);
    await prepareSiteDeployment({ storage, siteRoot });

    await assert.rejects(
        markSiteDeployed({
            storage,
            deploymentHash: '0'.repeat(64),
            sourcePrefix: 'snapshot',
            sourceContentHash: '1'.repeat(64),
            snapshotCompletedAt: '2026-08-30T01:02:03.456Z',
            siteRoot,
        }),
        /changed after deployment preparation/
    );
    assert.equal(await storage.getBuffer(SITE_DEPLOYMENT_STATE_KEY), null);
    assert.match(siteDirectoryHash(siteRoot), /^[0-9a-f]{64}$/);
});

test('Workers 配置变化会改变部署哈希', (t) => {
    const siteRoot = temporarySite(t);
    const configPath = path.join(siteRoot, '..', `${path.basename(siteRoot)}.jsonc`);
    fs.writeFileSync(configPath, '{"name":"notion-games"}\n');
    t.after(() => fs.rmSync(configPath, { force: true }));

    const first = siteDirectoryHash(siteRoot, configPath);
    fs.writeFileSync(configPath, '{"name":"notion-games-next"}\n');
    const second = siteDirectoryHash(siteRoot, configPath);

    assert.notEqual(second, first);
    assert.throws(
        () => siteDirectoryHash(siteRoot, `${configPath}.missing`),
        /Workers configuration does not exist/
    );
});

test('最新备份损坏时拒绝生成站点', async () => {
    const storage = new MemoryStorage();
    const snapshot = await seedLatestSnapshot(storage);
    storage.objects.delete(`${snapshot.prefix}/games.csv`);

    await assert.rejects(
        readLatestSnapshot(storage),
        /Latest snapshot is invalid: games\.csv is missing or corrupt/
    );
});
