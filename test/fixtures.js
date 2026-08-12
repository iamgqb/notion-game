/** @author yuecheng */
function gamePage(overrides = {}) {
    return {
        id: overrides.id ?? 'page-id',
        properties: {
            name: {
                type: 'title',
                title: [{ plain_text: overrides.name ?? '游戏 A' }],
            },
            appid: { type: 'number', number: overrides.appid ?? 10 },
            play_time: {
                type: 'number',
                number: overrides.play_time ?? 100,
            },
            achievement: {
                type: 'number',
                number: overrides.achievement ?? 0.5,
            },
            buy_time: {
                type: 'date',
                date:
                    overrides.buy_time === undefined
                        ? {
                              start: '2026-01-02',
                              end: null,
                              time_zone: null,
                          }
                        : overrides.buy_time,
            },
            status: {
                type: 'multi_select',
                multi_select:
                    overrides.status ?? [{ name: '已购买' }, { name: '游玩中' }],
            },
            favorite: {
                type: 'checkbox',
                checkbox: overrides.favorite ?? false,
            },
            store: {
                type: 'formula',
                formula: { string: overrides.formula ?? 'Steam' },
            },
        },
    };
}

/** @author yuecheng */
function historyPage(overrides = {}) {
    return {
        id: overrides.id ?? 'history-id',
        properties: {
            name: {
                type: 'title',
                title: [{ plain_text: overrides.name ?? '游戏 A' }],
            },
            appid: { type: 'number', number: overrides.appid ?? 10 },
            time: { type: 'number', number: overrides.time ?? 30 },
            date: {
                type: 'date',
                date: {
                    start: overrides.date ?? '2026-01-03',
                    end: null,
                    time_zone: null,
                },
            },
        },
    };
}

module.exports = { gamePage, historyPage };
