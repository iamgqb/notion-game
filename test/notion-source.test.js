const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchDatabasePages, queryPage } = require('../src/backup/notion-source');

/** @author yuecheng */
function response(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

test('Notion 分页会携带 next_cursor 并合并所有结果', async () => {
    const requestBodies = [];
    const responses = [
        response(200, {
            results: [{ id: '1' }],
            has_more: true,
            next_cursor: 'cursor-2',
        }),
        response(200, {
            results: [{ id: '2' }],
            has_more: false,
            next_cursor: null,
        }),
    ];
    const pages = await fetchDatabasePages({
        notionApiKey: 'secret',
        databaseId: 'database',
        fetchImpl: async (_url, options) => {
            requestBodies.push(JSON.parse(options.body));
            return responses.shift();
        },
    });

    assert.deepEqual(pages, [{ id: '1' }, { id: '2' }]);
    assert.deepEqual(requestBodies, [
        { page_size: 100 },
        { page_size: 100, start_cursor: 'cursor-2' },
    ]);
});

test('Notion 429 遵守 Retry-After 后重试', async () => {
    const delays = [];
    const responses = [
        response(429, { error: 'rate_limited' }, { 'retry-after': '2' }),
        response(200, { results: [], has_more: false, next_cursor: null }),
    ];

    const result = await queryPage({
        notionApiKey: 'secret',
        databaseId: 'database',
        fetchImpl: async () => responses.shift(),
        sleep: async (delay) => delays.push(delay),
    });

    assert.deepEqual(delays, [2000]);
    assert.deepEqual(result.results, []);
});

test('Notion 5xx 使用有限指数退避', async () => {
    const delays = [];
    const responses = [
        response(503, {}),
        response(502, {}),
        response(200, { results: [], has_more: false, next_cursor: null }),
    ];

    await queryPage({
        notionApiKey: 'secret',
        databaseId: 'database',
        fetchImpl: async () => responses.shift(),
        sleep: async (delay) => delays.push(delay),
    });

    assert.deepEqual(delays, [1000, 2000]);
});

test('Notion 网络错误使用有限指数退避', async () => {
    const delays = [];
    let attempt = 0;

    const result = await queryPage({
        notionApiKey: 'secret',
        databaseId: 'database',
        fetchImpl: async () => {
            attempt += 1;
            if (attempt < 3) throw new Error('network unavailable');
            return response(200, {
                results: [],
                has_more: false,
                next_cursor: null,
            });
        },
        sleep: async (delay) => delays.push(delay),
    });

    assert.deepEqual(delays, [1000, 2000]);
    assert.deepEqual(result.results, []);
});
