const test = require('node:test');
const assert = require('node:assert/strict');
const { ACHIEVEMENT_CACHE_KEY, loadAchievementData, refreshAchievements } = require('../src/achievements/service');

const start = new Date('2026-10-29T00:00:00Z');
const game = (appid, extra = {}) => ({ appid, name: `游戏 ${appid}`, play_time: 30, favorite: false, achievement: 0.5, ...extra });
const detail = (unlocked = true) => ({ status: 'available', achievements: [{
    id: 'A', name: '成就 A', description: '达成条件', hidden: false, icon: null, iconGray: null,
    unlocked, unlockedAt: unlocked ? '2026-01-01T00:00:00.000Z' : null, globalPercent: 2,
}] });
const defaults = { steamKey: 'secret', steamId: 'player', now: start, fetchDetails: async () => detail() };

test('成就采集覆盖已游玩或喜欢游戏，按 App ID 去重并限制并发', async () => {
    let active = 0;
    let peak = 0;
    const seen = [];
    const result = await refreshAchievements({
        ...defaults,
        games: [game(1), game(1, { play_time: 90 }), game(2, { play_time: 0, achievement: null }), game(3, { play_time: 0, favorite: true }), game(4), game(5, { play_time: 0, achievement: null }), game(5, { play_time: 0, achievement: null, favorite: true })],
        concurrency: 2,
        fetchDetails: async ({ appid }) => { seen.push(appid); peak = Math.max(peak, ++active); await Promise.resolve(); active--; return detail(); },
    });
    assert.deepEqual(seen.sort(), [1, 3, 4, 5]);
    assert.ok(peak <= 2);
    assert.equal(result.cache.entries[1].playTimeMinutes, 90);
    assert.equal(result.data.games.length, 4);
    assert.ok(!JSON.stringify(result).includes('secret'));
});

test('缓存有效时不调用 Steam；仅检查时间变化不改变公开数据', async () => {
    const first = await refreshAchievements({ ...defaults, games: [game(1)] });
    const cached = await refreshAchievements({ ...defaults, games: [game(1)], cache: first.cache, now: new Date('2026-10-29T01:00:00Z'), fetchDetails: async () => assert.fail('fresh cache must not call Steam') });
    assert.equal(cached.changed, false);
    assert.deepEqual(cached.data, first.data);
    const checked = await refreshAchievements({ ...defaults, games: [game(1)], cache: first.cache, now: new Date('2026-10-30T01:00:00Z') });
    assert.equal(checked.refreshed, 1);
    assert.equal(checked.changed, true);
    assert.deepEqual(checked.data, first.data);
});

test('游玩时长变化立即刷新成就，新的解锁状态进入公开数据', async () => {
    const first = await refreshAchievements({ ...defaults, games: [game(1)] });
    const updated = await refreshAchievements({ ...defaults, games: [game(1, { play_time: 40 })], cache: first.cache,
        now: new Date('2026-10-29T01:00:00Z'), fetchDetails: async () => detail(false) });
    assert.equal(updated.refreshed, 1);
    assert.equal(updated.data.games[0].achievements[0].unlocked, false);
    assert.notEqual(updated.data.updatedAt, first.data.updatedAt);
});

test('单次采集失败保留有效明细并退避，避免把接口故障发布成空成就', async () => {
    const first = await refreshAchievements({ ...defaults, games: [game(1)] });
    const failing = { ...defaults, games: [game(1, { play_time: 40 })], cache: first.cache,
        now: new Date('2026-10-29T01:00:00Z'), fetchDetails: async () => { throw new Error('temporary'); } };
    const stale = await refreshAchievements(failing);
    assert.equal(stale.failed, 1);
    assert.deepEqual(stale.data, first.data);
    const backoff = await refreshAchievements({ ...failing, cache: stale.cache, now: new Date('2026-10-29T01:20:00Z'), fetchDetails: async () => assert.fail('retry backoff') });
    assert.equal(backoff.refreshed, 0);
    await assert.rejects(refreshAchievements({ ...failing, cache: null }), /refusing to publish an empty/);
});

test('账号切换不会复用其他玩家的缓存；无成就游戏被单独统计', async () => {
    const first = await refreshAchievements({ ...defaults, games: [game(1)] });
    await assert.rejects(refreshAchievements({ ...defaults, steamId: 'another-player', games: [game(1)], cache: first.cache,
        fetchDetails: async () => { throw new Error('private'); } }), /refusing to publish an empty/);
    const empty = await refreshAchievements({ ...defaults, games: [game(1)], fetchDetails: async () => ({ status: 'no_achievements', achievements: [] }) });
    assert.deepEqual(empty.data.coverage, { eligibleGames: 1, gamesWithData: 0, noAchievements: 1, unavailableGames: 0 });
});

test('R2 成就缓存使用条件写入，缓存未到刷新期时没有写操作', async () => {
    let object = null;
    const writes = [];
    const storage = {
        getJson: async (key) => { assert.equal(key, ACHIEVEMENT_CACHE_KEY); return object; },
        put: async (key, body, options) => { writes.push({ key, options }); object = { value: JSON.parse(body), etag: 'v1' }; },
    };
    await loadAchievementData({ ...defaults, storage, games: [game(1)] });
    assert.equal(writes[0].options.ifNoneMatch, '*');
    await loadAchievementData({ ...defaults, storage, games: [game(1)] });
    assert.equal(writes.length, 1);
    await loadAchievementData({ ...defaults, storage, games: [game(1, { play_time: 60 })] });
    assert.equal(writes[1].options.ifMatch, 'v1');
});
