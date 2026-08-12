const test = require('node:test');
const assert = require('node:assert/strict');
const {
    contentHash,
    gamesCsv,
    normalizeGames,
    normalizeHistory,
    selectSnapshotsToDelete,
} = require('../src/backup/core');
const { gamePage, historyPage } = require('./fixtures');

test('业务哈希忽略页面元数据、Formula 和多选顺序', () => {
    const leftGames = normalizeGames([gamePage()]);
    const rightGames = normalizeGames([
        gamePage({
            id: 'another-page-id',
            formula: 'Epic',
            status: [{ name: '游玩中' }, { name: '已购买' }],
        }),
    ]);
    const history = normalizeHistory([historyPage()]);

    assert.deepEqual(leftGames, rightGames);
    assert.equal(
        contentHash(leftGames, history),
        contentHash(rightGames, history)
    );
});

test('buy_time、status、favorite 任一变化都会改变业务哈希', () => {
    const history = normalizeHistory([historyPage()]);
    const baseline = contentHash(normalizeGames([gamePage()]), history);
    const changes = [
        gamePage({
            buy_time: {
                start: '2026-02-01',
                end: null,
                time_zone: 'Asia/Singapore',
            },
        }),
        gamePage({ status: [{ name: '已通关' }] }),
        gamePage({ favorite: true }),
    ];

    for (const changed of changes) {
        assert.notEqual(contentHash(normalizeGames([changed]), history), baseline);
    }
});

test('历史记录排序稳定且保留完全相同的重复记录', () => {
    const records = normalizeHistory([
        historyPage({ id: '2' }),
        historyPage({ id: '1' }),
        historyPage({ id: '3', date: '2025-12-01' }),
    ]);

    assert.equal(records.length, 3);
    assert.equal(records[0].date.start, '2025-12-01');
    assert.deepEqual(records[1], records[2]);
});

test('CSV 正确处理中文、逗号、引号、换行、日期范围和布尔值', () => {
    const csv = gamesCsv(
        normalizeGames([
            gamePage({
                name: '逗号, "引号"\n换行',
                favorite: true,
                buy_time: {
                    start: '2026-01-01',
                    end: '2026-01-02',
                    time_zone: 'Asia/Singapore',
                },
            }),
        ])
    );

    assert.match(csv, /"逗号, ""引号""\n换行"/);
    assert.match(csv, /2026-01-01,2026-01-02,Asia\/Singapore/);
    assert.match(csv, /"已购买,游玩中",true\r\n$/);
});

test('游戏库必需字段缺失或类型漂移时拒绝生成备份数据', () => {
    const missingFavorite = gamePage();
    delete missingFavorite.properties.favorite;
    assert.throws(
        () => normalizeGames([missingFavorite]),
        /games page page-id.*favorite.*missing/
    );

    const wrongStatusType = gamePage();
    wrongStatusType.properties.status = {
        type: 'select',
        select: { name: '已购买' },
    };
    assert.throws(
        () => normalizeGames([wrongStatusType]),
        /games page page-id.*status.*multi_select.*select/
    );
});

test('历史库字段类型漂移时拒绝生成备份数据', () => {
    const wrongDateType = historyPage();
    wrongDateType.properties.date = {
        type: 'rich_text',
        rich_text: [{ plain_text: '2026-01-03' }],
    };

    assert.throws(
        () => normalizeHistory([wrongDateType]),
        /history page history-id.*date.*date.*rich_text/
    );
});

test('结构有效的 Notion 空值仍可规范化', () => {
    const page = gamePage({ name: '', buy_time: null, status: [] });
    page.properties.appid.number = null;
    page.properties.play_time.number = null;
    page.properties.achievement.number = null;

    assert.deepEqual(normalizeGames([page]), [
        {
            name: '',
            appid: null,
            play_time: null,
            achievement: null,
            buy_time: null,
            status: [],
            favorite: false,
        },
    ]);
});

test('保留策略保留最新、90 天内全部以及较早月份的最后一份', () => {
    const snapshots = [
        { prefix: 'latest', completedAt: '2024-01-01T00:00:00.000Z' },
        { prefix: 'recent', completedAt: '2026-07-20T00:00:00.000Z' },
        { prefix: 'april-old', completedAt: '2026-04-01T00:00:00.000Z' },
        { prefix: 'april-last', completedAt: '2026-04-15T00:00:00.000Z' },
        { prefix: 'expired', completedAt: '2025-01-01T00:00:00.000Z' },
    ];

    assert.deepEqual(
        selectSnapshotsToDelete(
            snapshots,
            'latest',
            new Date('2026-08-12T00:00:00.000Z')
        ).sort(),
        ['april-old', 'expired']
    );
});
