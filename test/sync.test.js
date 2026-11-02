const test = require('node:test');
const assert = require('node:assert/strict');
const notion = require('../src/notion');
const { syncSteamGamesToNotion } = require('../src/index');

/** @author yuecheng */
function mockSync(t, { now, games, pages = [], advanceTo, storeItems, artworkStatus = 200 }) {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
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
        if (url.startsWith('https://api.steampowered.com/IStoreBrowseService/')) {
            return {
                ok: artworkStatus === 200,
                status: artworkStatus,
                json: async () => ({ response: { store_items: storeItems ?? games.map((game) => ({
                    appid: game.appid,
                    success: 1,
                    assets: {
                        asset_url_format: `steam/apps/${game.appid}/` + '${FILENAME}?t=123',
                        library_hero: 'hero-hash/library_hero.jpg',
                        header: 'header-hash/header_schinese.jpg',
                    },
                })) } }),
            };
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

test('新增游戏使用接口返回的 library_hero 封面，保留哈希和版本', async (t) => {
    const { created } = mockSync(t, {
        now: '2026-11-02T00:00:00Z',
        games: [{ appid: 570, name: 'Dota 2', playtime_forever: 0 }],
    });

    await syncSteamGamesToNotion();

    assert.deepEqual(created.mock.calls[0].arguments[2].cover, {
        type: 'external',
        external: { url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/hero-hash/library_hero.jpg?t=123' },
    });
});

function existingGame(coverUrl) {
    return {
        id: 'page-570',
        cover: { type: 'external', external: { url: coverUrl } },
        properties: {
            appid: { number: 570 },
            name: { title: [{ text: { content: 'Dota 2' } }] },
            play_time: { number: 60 },
        },
    };
}

test('已有游戏未再游玩也会修复旧封面，且不产生历史记录', async (t) => {
    const { created, updated } = mockSync(t, {
        now: '2026-11-02T00:00:00Z',
        games: [{ appid: 570, name: 'Dota 2', playtime_forever: 60 }],
        pages: [existingGame('https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg')],
    });

    await syncSteamGamesToNotion();

    assert.equal(created.mock.callCount(), 0);
    assert.equal(updated.mock.callCount(), 1);
    assert.deepEqual(updated.mock.calls[0].arguments[2], {
        properties: {},
        cover: { type: 'external', external: {
            url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/hero-hash/library_hero.jpg?t=123',
        } },
    });
});

test('封面已是最新且业务数据未变时不会重复更新 Notion', async (t) => {
    const { created, updated } = mockSync(t, {
        now: '2026-11-02T00:00:00Z',
        games: [{ appid: 570, name: 'Dota 2', playtime_forever: 60 }],
        pages: [existingGame('https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/hero-hash/library_hero.jpg?t=123')],
    });

    await syncSteamGamesToNotion();

    assert.equal(created.mock.callCount(), 0);
    assert.equal(updated.mock.callCount(), 0);
});

test('商店资源请求失败时保留原封面，仍可更新游戏名称', async (t) => {
    const { created, updated } = mockSync(t, {
        now: '2026-11-02T00:00:00Z',
        games: [{ appid: 570, name: '新名称', playtime_forever: 60 }],
        pages: [existingGame('https://example.com/existing-cover.jpg')],
        artworkStatus: 403,
    });

    await syncSteamGamesToNotion();

    assert.equal(created.mock.callCount(), 0);
    assert.equal(updated.mock.callCount(), 1);
    assert.equal(Object.hasOwn(updated.mock.calls[0].arguments[2], 'cover'), false);
    assert.equal(updated.mock.calls[0].arguments[2].properties.name.title[0].text.content, '新名称');
});

test('已下架游戏无资源元数据时保留已有封面', async (t) => {
    const { updated } = mockSync(t, {
        now: '2026-11-02T00:00:00Z',
        games: [{ appid: 570, name: 'Dota 2', playtime_forever: 60 }],
        pages: [existingGame('https://example.com/existing-cover.jpg')],
        storeItems: [{ appid: 570, success: 2 }],
    });

    await syncSteamGamesToNotion();

    assert.equal(updated.mock.callCount(), 0);
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
