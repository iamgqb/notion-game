const test = require('node:test');
const assert = require('node:assert/strict');
const { sample, selectArchive } = require('../site/showcase');

function memoryStorage() {
    let value = null;
    return { getItem: () => value, setItem: (key, next) => { value = next; } };
}

test('首页相邻刷新更换各区选品，保持资格、数量和区内去重', () => {
    const games = Array.from({ length: 20 }, (_, index) => ({
        appid: index + 1, favorite: index < 12, playTimeMinutes: 60,
        achievementRate: index % 2 ? 0.5 : 1, lastPlayed: index < 18 ? '2026-10-01' : null,
    }));
    const achievements = [1, 2, 3, 4].flatMap(appid => [
        { appid, key: `${appid}:A`, unlocked: true, globalPercent: 1 },
        { appid, key: `${appid}:B`, unlocked: true, globalPercent: 2 },
        { appid, key: `${appid}:locked`, unlocked: false, globalPercent: 0.1 },
        { appid, key: `${appid}:common`, unlocked: true, globalPercent: 90 },
    ]);
    const achievementGames = new Map([1, 2, 3, 4].map(appid => [appid, { achievements: achievements.filter(a => a.appid === appid) }]));
    const storage = memoryStorage();
    let previous;
    for (let refresh = 0; refresh < 20; refresh++) {
        // A repeated random stream still must not repeat the previous batch.
        const result = selectArchive({ games, achievements, achievementGames, storage, random: () => 0 });
        assert.equal(result.picks.length, 6);
        assert.ok(result.picks.every(game => game.favorite));
        assert.equal(result.completed.length, 6);
        assert.ok(result.completed.every(game => game.achievementRate === 1));
        assert.ok(result.memories.every(game => game.lastPlayed));
        assert.equal(new Set(result.rare.map(a => a.appid)).size, result.rare.length);
        assert.ok(result.rare.every(a => a.unlocked && a.globalPercent <= 5));
        if (previous) {
            assert.notEqual(result.hero.appid, previous.hero.appid);
            for (const region of ['picks', 'completed', 'memories', 'rare']) {
                const ids = items => items.map(a => a.key ?? a.appid).sort();
                assert.notDeepEqual(ids(result[region]), ids(previous[region]), region);
            }
        }
        previous = result;
    }
});

test('候选不足、重复候选或浏览器存储不可用时不产生伪造内容', () => {
    assert.deepEqual(sample([], 6), []);
    assert.equal(sample([{ appid: 1 }, { appid: 1 }], 6).length, 1);
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const result = selectArchive({ games: [], achievements: [], achievementGames: new Map(), storage });
    assert.equal(result.hero, undefined);
    assert.deepEqual(result.rare, []);
    assert.deepEqual(result.completed, []);
});
