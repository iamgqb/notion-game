const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchAchievementDetails, requestSteam } = require('../src/achievements/steam-source');

const image = 'https://steamcdn-a.akamaihd.net/example.jpg';
const definition = (name, extra = {}) => ({ name, displayName: `成就 ${name}`, icon: image, icongray: image, hidden: 0, ...extra });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

test('成就明细合并中文定义、玩家状态、真实解锁时间和全球比例', async () => {
    const urls = [];
    const result = await fetchAchievementDetails({
        steamKey: 'secret-key', steamId: 'player', appid: 1,
        fetchImpl: async (url) => {
            urls.push(new URL(url));
            if (url.includes('GetSchemaForGame')) return json({ game: { availableGameStats: { achievements: [
                definition('A', { hidden: '1' }), definition('B'), definition('C'),
            ] } } });
            if (url.includes('GetPlayerAchievements')) return json({ playerstats: { success: true, achievements: [
                { apiname: 'A', achieved: 1, unlocktime: 1700000000, description: '已解锁的隐藏说明' },
                { apiname: 'B', achieved: 0, unlocktime: 1700000000 },
            ] } });
            return json({ achievementpercentages: { achievements: [
                { name: 'A', percent: '0' }, { name: 'B', percent: 120 },
            ] } });
        },
    });
    assert.equal(result.status, 'available');
    const [a, b, c] = result.achievements;
    assert.equal(a.name, '成就 A');
    assert.equal(a.description, '已解锁的隐藏说明');
    assert.equal(a.hidden, true);
    assert.equal(a.globalPercent, 0);
    assert.equal(a.unlockedAt, '2023-11-14T22:13:20.000Z');
    assert.equal(b.unlocked, false);
    assert.equal(b.unlockedAt, null);
    assert.equal(b.globalPercent, null);
    assert.equal(c.unlocked, null);
    assert.equal(urls[0].searchParams.get('l'), 'schinese');
    assert.equal(urls.find((url) => url.pathname.includes('GetPlayerAchievements')).searchParams.get('steamid'), 'player');
    assert.ok(!JSON.stringify(result).includes('secret-key'));
});

test('全球比例接口不可用时保留已有比例，包括零值', async () => {
    const result = await fetchAchievementDetails({
        steamKey: 'key', steamId: 'player', appid: 1, maxAttempts: 1,
        previous: { achievements: [{ id: 'A', globalPercent: 0 }] },
        fetchImpl: async (url) => {
            if (url.includes('GetSchemaForGame')) return json({ game: { availableGameStats: { achievements: [definition('A')] } } });
            if (url.includes('GetPlayerAchievements')) return json({ playerstats: { achievements: [{ apiname: 'A', achieved: 1 }] } });
            return json({}, 503);
        },
    });
    assert.equal(result.achievements[0].globalPercent, 0);
});

test('玩家成就不可访问时拒绝把未知状态当作未解锁', async () => {
    await assert.rejects(fetchAchievementDetails({
        steamKey: 'do-not-leak', steamId: 'player', appid: 1, maxAttempts: 1,
        fetchImpl: async (url) => {
            if (url.includes('GetSchemaForGame')) return json({ game: { availableGameStats: { achievements: [definition('A')] } } });
            return json({}, url.includes('GetPlayerAchievements') ? 403 : 200);
        },
    }), (error) => error.code === 'STEAM_HTTP' && !error.message.includes('do-not-leak'));
});

test('无成就游戏只查询定义；已有有效明细不会被突然消失的定义清空', async () => {
    let calls = 0;
    const options = { steamKey: 'key', steamId: 'player', appid: 1, fetchImpl: async () => { calls++; return json({ game: {} }); } };
    assert.deepEqual(await fetchAchievementDetails(options), { status: 'no_achievements', achievements: [] });
    assert.equal(calls, 1);
    await assert.rejects(fetchAchievementDetails({ ...options, previous: { achievements: [{ id: 'A' }] } }), /refusing to replace/);
});

test('Steam 限流遵守有限重试，网络错误不泄漏含密钥的 URL', async () => {
    const delays = [];
    let calls = 0;
    await requestSteam('GetSchemaForGame', 'v2', { key: 'sensitive' }, {
        fetchImpl: async () => ++calls === 1 ? json({}, 429, { 'retry-after': '60' }) : json({ game: {} }),
        sleep: async (delay) => delays.push(delay),
    });
    assert.equal(calls, 2);
    assert.deepEqual(delays, [5000]);
    await assert.rejects(requestSteam('GetSchemaForGame', 'v2', { key: 'sensitive' }, {
        maxAttempts: 1,
        fetchImpl: async (url) => { throw new Error(url); },
    }), (error) => error.code === 'STEAM_NETWORK' && !error.message.includes('sensitive'));
});
