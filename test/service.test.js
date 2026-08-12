const test = require('node:test');
const assert = require('node:assert/strict');
const { runAudit, runBackup } = require('../src/backup/service');
const { gamePage, historyPage } = require('./fixtures');

/** @author yuecheng */
class MemoryStorage {
    constructor() {
        this.objects = new Map();
        this.operations = [];
        this.version = 0;
    }

    async getBuffer(key) {
        this.operations.push({ type: 'get', key });
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
        this.operations.push({ type: 'put', key });
        if (this.failPutKey === key) {
            throw new Error(`injected put failure for ${key}`);
        }
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

    async copy(sourceKey, destinationKey) {
        this.operations.push({ type: 'copy', sourceKey, destinationKey });
        if (
            this.failCopyDestinationSuffix &&
            destinationKey.endsWith(this.failCopyDestinationSuffix)
        ) {
            throw new Error(`injected copy failure for ${destinationKey}`);
        }
        const source = this.objects.get(sourceKey);
        if (!source) throw new Error(`missing source ${sourceKey}`);
        this.objects.set(destinationKey, {
            body: Buffer.from(source.body),
            etag: `"${++this.version}"`,
        });
    }

    async listKeys(prefix) {
        this.operations.push({ type: 'list', prefix });
        return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    }

    async deleteKeys(keys) {
        this.operations.push({ type: 'delete', keys });
        for (const key of keys) this.objects.delete(key);
    }

    async deletePrefix(prefix) {
        const keys = await this.listKeys(prefix);
        await this.deleteKeys(keys);
        return keys.length;
    }
}

const config = {
    notionApiKey: 'secret',
    databaseId: 'games',
    historyDatabaseId: 'history',
    timeZone: 'Asia/Singapore',
};

/** @author yuecheng */
function fetchPagesFor(gamePages, historyPages) {
    return async ({ databaseId }) =>
        databaseId === 'games' ? gamePages : historyPages;
}

test('首次备份按 manifest 最后生效并更新 latest 指针', async () => {
    const storage = new MemoryStorage();
    const result = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2026-08-12T01:02:03.456Z'),
        runId: 'test-run',
    });

    assert.equal(result.status, 'CREATED_SNAPSHOT');
    assert.equal(result.recordCounts.games, 1);
    assert.ok(storage.objects.has('state/latest.json'));
    assert.ok(storage.objects.has(`${result.prefix}/manifest.json`));
    assert.equal(
        [...storage.objects.keys()].some((key) => key.startsWith('staging/')),
        false
    );

    const copies = storage.operations.filter((operation) => operation.type === 'copy');
    assert.match(copies.at(-1).destinationKey, /manifest\.json$/);
    const stateWriteIndex = storage.operations.findIndex(
        (operation) => operation.type === 'put' && operation.key === 'state/latest.json'
    );
    const manifestCopyIndex = storage.operations.findIndex(
        (operation) =>
            operation.type === 'copy' && /snapshots\/.+\/manifest\.json$/.test(operation.destinationKey)
    );
    assert.ok(stateWriteIndex > manifestCopyIndex);
});

test('业务数据无变化且最新快照完整时不执行任何 R2 写操作', async () => {
    const storage = new MemoryStorage();
    const fetchPages = fetchPagesFor([gamePage()], [historyPage()]);
    await runBackup({
        config,
        storage,
        fetchPages,
        now: () => new Date('2026-08-12T01:02:03.456Z'),
        runId: 'first',
    });
    storage.operations = [];

    const result = await runBackup({
        config,
        storage,
        fetchPages,
        now: () => new Date('2026-08-13T01:02:03.456Z'),
        runId: 'second',
    });

    assert.equal(result.status, 'SKIPPED_NO_CHANGE');
    assert.equal(
        storage.operations.some((operation) =>
            ['put', 'copy', 'delete'].includes(operation.type)
        ),
        false
    );
});

test('任一 staging 数据文件上传失败时不会产生有效快照清单', async () => {
    const storage = new MemoryStorage();
    storage.failPutKey = 'staging/failing/history.csv';

    await assert.rejects(
        runBackup({
            config,
            storage,
            fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
            now: () => new Date('2026-08-12T01:02:03.456Z'),
            runId: 'failing',
        }),
        /injected put failure/
    );

    assert.equal(
        [...storage.objects.keys()].some((key) =>
            key.startsWith('snapshots/') && key.endsWith('/manifest.json')
        ),
        false
    );
    assert.equal(storage.objects.has('state/latest.json'), false);
});

test('业务数据无变化但最新快照损坏时创建修复快照', async () => {
    const storage = new MemoryStorage();
    const fetchPages = fetchPagesFor([gamePage()], [historyPage()]);
    const first = await runBackup({
        config,
        storage,
        fetchPages,
        now: () => new Date('2026-08-12T01:02:03.456Z'),
        runId: 'first',
    });
    storage.objects.delete(`${first.prefix}/games.csv`);

    const repaired = await runBackup({
        config,
        storage,
        fetchPages,
        now: () => new Date('2026-08-13T01:02:03.456Z'),
        runId: 'repair',
    });

    assert.equal(repaired.status, 'CREATED_REPAIR_SNAPSHOT');
    assert.notEqual(repaired.prefix, first.prefix);
});

test('latest 指针 JSON 损坏时使用原 ETag 安全替换', async () => {
    const storage = new MemoryStorage();
    storage.objects.set('state/latest.json', {
        body: Buffer.from('{broken'),
        etag: '"broken-etag"',
    });

    const result = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2026-08-12T01:02:03.456Z'),
        runId: 'repair-pointer',
    });

    assert.equal(result.status, 'CREATED_REPAIR_SNAPSHOT');
    assert.doesNotThrow(() =>
        JSON.parse(storage.objects.get('state/latest.json').body.toString('utf8'))
    );
});

test('历史记录变化会创建包含两个数据库的新完整快照', async () => {
    const storage = new MemoryStorage();
    await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2026-08-12T01:02:03.456Z'),
        runId: 'first',
    });
    const result = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor(
            [gamePage()],
            [historyPage(), historyPage({ id: 'new', time: 20 })]
        ),
        now: () => new Date('2026-08-13T01:02:03.456Z'),
        runId: 'second',
    });

    assert.equal(result.status, 'CREATED_SNAPSHOT');
    assert.deepEqual(result.recordCounts, { games: 1, history: 2 });
});

test('审计验证最新快照并清理过期前缀', async () => {
    const storage = new MemoryStorage();
    const first = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2025-01-01T01:02:03.456Z'),
        runId: 'old',
    });
    const latest = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage({ favorite: true })], [historyPage()]),
        now: () => new Date('2026-08-01T01:02:03.456Z'),
        runId: 'latest',
    });

    const audit = await runAudit({
        config,
        storage,
        now: new Date('2026-08-12T01:02:03.456Z'),
    });

    assert.equal(audit.status, 'AUDIT_OK');
    assert.equal(audit.deletedSnapshots, 1);
    assert.equal(
        [...storage.objects.keys()].some((key) => key.startsWith(`${first.prefix}/`)),
        false
    );
    assert.ok(storage.objects.has(`${latest.prefix}/manifest.json`));
});

test('审计在锁定安全宽限期后清理没有 manifest 的快照前缀', async () => {
    const storage = new MemoryStorage();
    const latest = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2025-12-31T01:02:03.456Z'),
        runId: 'latest-for-orphan-audit',
    });
    storage.failCopyDestinationSuffix = '/manifest.json';
    await assert.rejects(
        runBackup({
            config,
            storage,
            fetchPages: fetchPagesFor(
                [gamePage({ favorite: true })],
                [historyPage()]
            ),
            now: () => new Date('2026-01-01T01:02:03.456Z'),
            runId: 'failed-before-final-manifest',
        }),
        /injected copy failure/
    );
    storage.failCopyDestinationSuffix = undefined;
    const orphanPrefix = [...storage.objects.keys()]
        .filter(
            (key) =>
                key.startsWith('snapshots/') &&
                !key.startsWith(`${latest.prefix}/`)
        )[0]
        .split('/')
        .slice(0, 5)
        .join('/');
    assert.ok(storage.objects.has(`${orphanPrefix}/games.csv`));
    assert.equal(storage.objects.has(`${orphanPrefix}/manifest.json`), false);

    const audit = await runAudit({
        config,
        storage,
        now: new Date('2026-08-12T01:02:03.456Z'),
    });

    assert.equal(audit.status, 'AUDIT_OK');
    assert.deepEqual(audit.deletedOrphanPrefixes, [orphanPrefix]);
    assert.deepEqual(audit.deferredOrphanPrefixes, []);
    assert.equal(storage.objects.has(`${orphanPrefix}/games.csv`), false);
});

test('审计识别但不删除仍处于 Bucket Lock 安全宽限期的孤儿前缀', async () => {
    const storage = new MemoryStorage();
    await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2026-08-01T01:02:03.456Z'),
        runId: 'latest-for-recent-orphan',
    });
    const orphanPrefix =
        'snapshots/2026/08/10/20260810T010203456Z-bbbbbbbbbbbb';
    storage.objects.set(`${orphanPrefix}/history.csv`, {
        body: Buffer.from('partial'),
        etag: '"recent-orphan"',
    });

    const audit = await runAudit({
        config,
        storage,
        now: new Date('2026-08-12T01:02:03.456Z'),
    });

    assert.equal(audit.status, 'AUDIT_OK_WITH_DEFERRED_ORPHANS');
    assert.deepEqual(audit.deletedOrphanPrefixes, []);
    assert.deepEqual(audit.deferredOrphanPrefixes, [orphanPrefix]);
    assert.ok(storage.objects.has(`${orphanPrefix}/history.csv`));
});

test('最新快照完整性失败时审计任务失败', async () => {
    const storage = new MemoryStorage();
    const snapshot = await runBackup({
        config,
        storage,
        fetchPages: fetchPagesFor([gamePage()], [historyPage()]),
        now: () => new Date('2026-08-01T01:02:03.456Z'),
        runId: 'audit-corrupt',
    });
    storage.objects.get(`${snapshot.prefix}/games.csv`).body = Buffer.from(
        'corrupt'
    );

    await assert.rejects(
        runAudit({
            config,
            storage,
            now: new Date('2026-08-12T01:02:03.456Z'),
        }),
        /integrity check failed/
    );
});
