const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSiteData } = require('../src/site/export-data');

/** @author yuecheng */
test('站点快照从只读业务数据派生最近游玩、喜欢和全成就统计', () => {
    const games = [
        {
            name: 'A',
            appid: 1,
            play_time: 180,
            achievement: 1,
            buy_time: { start: '2025-01-01', end: null, time_zone: null },
            status: ['已通关'],
            favorite: true,
        },
        {
            name: 'B',
            appid: 2,
            play_time: 30,
            achievement: 0.5,
            buy_time: null,
            status: [],
            favorite: false,
        },
    ];
    const history = [
        {
            name: 'A',
            appid: 1,
            time: 60,
            date: { start: '2026-08-01T00:00:00.000Z', end: null, time_zone: null },
        },
        {
            name: 'A',
            appid: 1,
            time: 30,
            date: { start: '2026-08-29T00:00:00.000Z', end: null, time_zone: null },
        },
    ];

    const result = buildSiteData(games, history, new Date('2026-08-30T00:00:00.000Z'));

    assert.deepEqual(result.meta.counts, {
        games: 2,
        history: 2,
        favorite: 1,
        perfected: 1,
        played: 2,
    });
    assert.equal(result.games[0].lastPlayed, '2026-08-29T00:00:00.000Z');
    assert.equal(result.games[0].lastSessionMinutes, 30);
    assert.equal(result.games[0].recentMinutes, 90);
    assert.equal(result.games[0].historyCount, 2);
    assert.equal(result.history[0].minutes, 30);
});
