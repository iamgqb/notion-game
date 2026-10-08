const test = require('node:test');
const assert = require('node:assert/strict');
const notion = require('../src/notion');
const { syncSteamGamesToNotion } = require('../src/index');

/** @author yuecheng */
function mockSync(t, { now, games, pages = [], advanceTo }) {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
    t.mock.method(console, 'log', () => {});
    t.mock.method(notion, 'queryDatabase', async () => ({
        results: pages,
        next_cursor: null,
    }));
    t.mock.method(globalThis, 'fetch', async (url) => {
        if (url.startsWith('https://api.steampowered.com/IPlayerService/')) {
            if (advanceTo) {
                t.mock.timers.setTime(new Date(advanceTo).getTime());
            }
            return { ok: true, json: async () => ({ response: { games } }) };
        }
        assert.ok(url.startsWith('https://api.steampowered.com/ISteamUserStats/'));
        return {
            ok: true,
            json: async () => ({
                playerstats: { achievements: [{ achieved: 1 }] },
            }),
        };
    });
    const created = t.mock.method(notion, 'createPage', async () => ({}));
    const updated = t.mock.method(notion, 'updatePage', async () => ({}));
    return { created, updated };
}

const dateCases = [
    ['凌晨扫描', '2026-10-07T19:00:00Z', '2026-10-07'],
    ['UTC+8 午夜前', '2026-10-07T15:59:59Z', '2026-10-06'],
    ['UTC+8 午夜后', '2026-10-07T16:00:00Z', '2026-10-07'],
    ['白天手动扫描', '2026-10-08T06:00:00Z', '2026-10-07'],
    ['跨月', '2026-09-30T19:00:00Z', '2026-09-30'],
    ['跨年', '2026-12-31T19:00:00Z', '2026-12-31'],
    ['闰年', '2024-02-29T19:00:00Z', '2024-02-29'],
];

for (const [name, now, expected] of dateCases) {
    test(`新增游戏购买日期使用 UTC+8 前一天：${name}`, async (t) => {
        const { created } = mockSync(t, {
            now,
            games: [{ appid: 1, name: '新游戏', playtime_forever: 0 }],
        });

        await syncSteamGamesToNotion();

        assert.equal(created.mock.callCount(), 1);
        const pageData = created.mock.calls[0].arguments[2];
        assert.deepEqual(pageData.properties.buy_time, {
            date: { start: expected },
        });
    });
}

test('扫描跨越午夜时，所有新增游戏仍使用扫描开始时的前一天', async (t) => {
    const { created } = mockSync(t, {
        now: '2026-10-07T15:59:59Z',
        advanceTo: '2026-10-07T16:00:01Z',
        games: [
            { appid: 1, name: '新游戏一', playtime_forever: 0 },
            { appid: 2, name: '新游戏二', playtime_forever: 0 },
        ],
    });

    await syncSteamGamesToNotion();

    assert.equal(created.mock.callCount(), 2);
    for (const { arguments: [, , pageData] } of created.mock.calls) {
        assert.equal(pageData.properties.buy_time.date.start, '2026-10-06');
    }
});

test('更新已有游戏时保留已有购买日期，空日期也不自动回填', async (t) => {
    const { created, updated } = mockSync(t, {
        now: '2026-10-07T19:00:00Z',
        games: [
            { appid: 1, name: '游戏一', playtime_forever: 0 },
            { appid: 2, name: '游戏二', playtime_forever: 0 },
        ],
        pages: ['2025-01-01', null].map((buyTime, index) => ({
            id: `page-${index + 1}`,
            properties: {
                appid: { number: index + 1 },
                name: { title: [{ text: { content: '旧名称' } }] },
                play_time: { number: 0 },
                buy_time: { date: buyTime ? { start: buyTime } : null },
            },
        })),
    });

    await syncSteamGamesToNotion();

    assert.equal(created.mock.callCount(), 0);
    assert.equal(updated.mock.callCount(), 2);
    for (const { arguments: [, , pageData] } of updated.mock.calls) {
        assert.equal(Object.hasOwn(pageData.properties, 'buy_time'), false);
    }
});
