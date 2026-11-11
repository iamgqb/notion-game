const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { selectRecentGame, duration } = require('../site/recently-playing');

const games = [
    { appid: 1, name: '游戏甲', playTimeMinutes: 10000, favorite: true },
    { appid: 2, name: '游戏乙', playTimeMinutes: 120, favorite: false },
];

test('最近在玩按七天累计增量选取，同一天多条记录合并，不受总时长和喜欢标记影响', () => {
    const history = [
        { appid: 1, date: '2026-11-05', minutes: 20 },
        { appid: 1, date: '2026-11-11', minutes: 20 },
        { appid: 2, date: '2026-11-09', minutes: 25 },
        { appid: 2, date: '2026-11-09', minutes: 30 },
        { appid: 2, date: '2026-11-10', minutes: 10 },
    ];
    const selected = selectRecentGame(games, history, '2026-11-11');
    assert.equal(selected.game, games[1]);
    assert.equal(selected.recentMinutes, 65);
    assert.equal(selected.lastDate, '2026-11-10');
    assert.equal(selected.startDate, '2026-11-05');
    assert.equal(selected.endDate, '2026-11-11');
});

test('七天窗口包含当天和前六天，排除更早、未来、非正数、无效日期和未归档记录', () => {
    const history = [
        { appid: 1, date: '2026-11-05T00:00:00.000+00:00', minutes: 10 },
        { appid: 1, date: '2026-11-11T00:00:00.000+00:00', minutes: 20 },
        { appid: 2, date: '2026-11-04', minutes: 9999 },
        { appid: 2, date: '2026-11-12', minutes: 9999 },
        { appid: 2, date: '2026-11-10', minutes: 0 },
        { appid: 2, date: '2026-11-10', minutes: -60 },
        { appid: 2, date: '2026-11-10', minutes: NaN },
        { appid: 2, date: 'invalid', minutes: 9999 },
        { appid: 999, date: '2026-11-11', minutes: 9999 },
    ];
    const selected = selectRecentGame(games, history, '2026-11-11');
    assert.equal(selected.appid, 1);
    assert.equal(selected.recentMinutes, 30);
});

test('连续七天无游玩或档案陈旧时无候选，不以最后一条历史记录重新锚定窗口', () => {
    const history = [{ appid: 1, date: '2026-11-04', minutes: 500 }];
    assert.equal(selectRecentGame(games, history, '2026-11-11'), null);
    assert.equal(selectRecentGame(games, history, '2027-01-01'), null);
    assert.equal(selectRecentGame(games, [], '2026-11-11'), null);
    assert.equal(selectRecentGame([], history, '2026-11-04'), null);
});

test('时长并列时优先最近玩过的一款，日期也相同时稳定按 App ID 选取', () => {
    const older = { appid: 1, date: '2026-11-05', minutes: 60 };
    const newer = { appid: 2, date: '2026-11-11', minutes: 60 };
    assert.equal(selectRecentGame(games, [older, newer], '2026-11-11').appid, 2);
    const tied = [{ ...older, date: newer.date }, newer];
    assert.equal(selectRecentGame([...games].reverse(), [...tied].reverse(), '2026-11-11').appid, 1);
});

test('跨年窗口仍按七个自然日累计', () => {
    const selected = selectRecentGame(games, [
        { appid: 1, date: '2026-12-28', minutes: 45 },
        { appid: 1, date: '2027-01-03', minutes: 15 },
        { appid: 2, date: '2026-12-27', minutes: 9999 },
    ], '2027-01-03');
    assert.equal(selected.startDate, '2026-12-28');
    assert.equal(selected.appid, 1);
    assert.equal(selected.recentMinutes, 60);
});

test('默认当天使用 Asia/Singapore，而不是 UTC 日期或快照时间', () => {
    class FixedDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : ['2026-11-10T16:30:00Z']));
        }
    }
    const context = { module: { exports: {} }, Date: FixedDate, Intl };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../site/recently-playing.js'), 'utf8'), context);
    const selected = context.module.exports.selectRecentGame(games, [
        { appid: 1, date: '2026-11-05', minutes: 30 },
        { appid: 2, date: '2026-11-04', minutes: 9999 },
    ]);
    assert.equal(selected.endDate, '2026-11-11');
    assert.equal(selected.appid, 1);
});

test('游玩时长显示精确到分钟，四舍五入不会产生六十分钟的余数', () => {
    assert.equal(duration(326), '5 小时 26 分钟');
    assert.equal(duration(60), '1 小时');
    assert.equal(duration(11), '11 分钟');
    assert.equal(duration(59.6), '1 小时');
});
