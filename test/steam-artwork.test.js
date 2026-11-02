const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchGameArtwork } = require('../src/steam-artwork');

function response(items) {
    return { ok: true, json: async () => ({ response: { store_items: items } }) };
}

test('Steam 资源解析兼容带哈希目录与旧文件名，保留本地化和版本参数', async () => {
    const artwork = await fetchGameArtwork([570, 2358720], { fetchImpl: async (url, { signal }) => {
        const request = JSON.parse(new URL(url).searchParams.get('input_json'));
        assert.deepEqual(request.ids, [{ appid: 570 }, { appid: 2358720 }]);
        assert.equal(request.data_request.include_assets, true);
        assert.equal(request.context.language, 'schinese');
        assert.ok(signal instanceof AbortSignal);
        assert.equal(new URL(url).searchParams.has('key'), false);
        return response([
            { appid: 570, success: 1, assets: {
                asset_url_format: 'steam/apps/570/${FILENAME}?t=1791407503',
                library_hero: '0e4a18e7b53d1d4d68bba65969919e6a85920b04/library_hero.jpg',
                library_capsule: '6cddc26cb124bd87d3fbacd58cd83ba33e4cb0e7/library_capsule_schinese.jpg',
                header: 'localized/header_schinese.jpg',
            } },
            { appid: 2358720, success: 1, assets: {
                asset_url_format: 'steam/apps/2358720/${FILENAME}?t=1760601605',
                library_hero: 'library_hero.jpg',
                library_capsule: 'library_600x900_schinese.jpg',
                header: 'header_schinese.jpg',
            } },
        ]);
    } });

    assert.equal(artwork[570].hero, 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/0e4a18e7b53d1d4d68bba65969919e6a85920b04/library_hero.jpg?t=1791407503');
    assert.match(artwork[570].header, /localized\/header_schinese\.jpg\?t=1791407503$/);
    assert.equal(artwork[570].portrait, 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/6cddc26cb124bd87d3fbacd58cd83ba33e4cb0e7/library_capsule_schinese.jpg?t=1791407503');
    assert.equal(artwork[2358720].hero, 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2358720/library_hero.jpg?t=1760601605');
    assert.match(artwork[2358720].portrait, /library_600x900_schinese\.jpg\?t=1760601605$/);
});

test('游戏库分批获取资源，忽略重复和无效 App ID', async () => {
    const batches = [];
    await fetchGameArtwork([...Array.from({ length: 101 }, (_, i) => i + 1), 1, 0, -1, null, '2'], {
        fetchImpl: async (url) => {
            batches.push(JSON.parse(new URL(url).searchParams.get('input_json')).ids);
            return response([]);
        },
    });
    assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 1]);
    assert.deepEqual(batches.flat().map(({ appid }) => appid), Array.from({ length: 101 }, (_, i) => i + 1));
});

test('忽略下架和未请求条目，缺少 hero 时允许使用横幅或 2x 主视觉', async () => {
    const result = await fetchGameArtwork([1, 2, 3], { fetchImpl: async () => response([
        { appid: 1, success: 2 },
        { appid: 2, success: 1, assets: {
            asset_url_format: 'steam/apps/2/${FILENAME}', header: 'hash/header.jpg',
        } },
        { appid: 3, success: 1, assets: {
            asset_url_format: 'steam/apps/3/${FILENAME}', library_hero_2x: 'hash/library_hero_2x.jpg',
            library_capsule_2x: 'portrait-hash/library_capsule_2x.jpg',
        } },
        { appid: 4, success: 1, assets: {} },
    ]) });
    assert.equal(result[1], undefined);
    assert.equal(result[4], undefined);
    assert.equal(result[2].hero, null);
    assert.match(result[2].header, /hash\/header\.jpg$/);
    assert.match(result[3].hero, /hash\/library_hero_2x\.jpg$/);
    assert.equal(result[2].portrait, null);
    assert.match(result[3].portrait, /portrait-hash\/library_capsule_2x\.jpg$/);
});

test('临时网络故障和限流会有限重试', async () => {
    let calls = 0;
    const delays = [];
    const artwork = await fetchGameArtwork([570], {
        sleep: async (delay) => delays.push(delay),
        fetchImpl: async () => {
            calls++;
            if (calls === 1) throw new Error('temporary network failure');
            if (calls === 2) return { ok: false, status: 429 };
            return response([]);
        },
    });
    assert.equal(calls, 3);
    assert.deepEqual(delays, [500, 1000]);
    assert.deepEqual(artwork, {});
});

test('永久 HTTP 错误立即失败，避免以空元数据覆盖当前站点', async () => {
    let calls = 0;
    await assert.rejects(fetchGameArtwork([570], { fetchImpl: async () => {
        calls++;
        return { ok: false, status: 403 };
    } }), /HTTP 403/);
    assert.equal(calls, 1);
});

test('异常响应和持续服务故障不会静默返回空数据', async () => {
    await assert.rejects(fetchGameArtwork([570], {
        maxAttempts: 1,
        fetchImpl: async () => ({ ok: true, json: async () => ({ response: {} }) }),
    }), /invalid store response/);
    let calls = 0;
    await assert.rejects(fetchGameArtwork([570], {
        sleep: async () => {},
        fetchImpl: async () => { calls++; return { ok: false, status: 503 }; },
    }), /HTTP 503/);
    assert.equal(calls, 3);
});

test('空游戏库不访问商店接口', async () => {
    assert.deepEqual(await fetchGameArtwork([], { fetchImpl: async () => {
        assert.fail('不应发送请求');
    } }), {});
});
