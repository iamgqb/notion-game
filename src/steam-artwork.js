const STORE_API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const ASSET_BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/';
const BATCH_SIZE = 50;

/**
 * 保留 Steam 返回的哈希目录、本地化文件名和资源版本。
 * @author iamgqb
 */
function assetUrl(assets, filename) {
    if (typeof filename !== 'string' || !filename ||
        typeof assets.asset_url_format !== 'string' ||
        !assets.asset_url_format.includes('${FILENAME}')) return null;
    try {
        const url = new URL(assets.asset_url_format.replace('${FILENAME}', filename), ASSET_BASE);
        return url.origin === new URL(ASSET_BASE).origin ? url.toString() : null;
    } catch {
        return null;
    }
}

/**
 * 批量读取公开商店资源；不需要 API 密钥，也不依赖旧的固定图片路径。
 * 请求失败时抛错，让调用方保留已发布的封面。
 * @author iamgqb
 */
async function fetchGameArtwork(appids, {
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxAttempts = 3,
} = {}) {
    const ids = [...new Set(appids)].filter((appid) => Number.isSafeInteger(appid) && appid > 0);
    const artwork = {};
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
        const batch = ids.slice(offset, offset + BATCH_SIZE);
        const url = new URL(STORE_API);
        url.searchParams.set('input_json', JSON.stringify({
            ids: batch.map((appid) => ({ appid })),
            context: { language: 'schinese', country_code: 'US' },
            data_request: { include_assets: true },
        }));
        let data;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(15000) });
                if (!response.ok) {
                    const error = new Error(`Steam artwork: HTTP ${response.status}`);
                    error.retryable = response.status === 429 || response.status >= 500;
                    throw error;
                }
                data = await response.json();
                if (!Array.isArray(data?.response?.store_items)) {
                    throw new Error('Steam artwork: invalid store response');
                }
                break;
            } catch (error) {
                if (error.retryable === false || attempt + 1 === maxAttempts) throw error;
                await sleep(500 * 2 ** attempt);
            }
        }
        for (const item of data.response.store_items) {
            if (item.success !== 1 || !batch.includes(item.appid) || !item.assets) continue;
            artwork[item.appid] = {
                hero: assetUrl(item.assets, item.assets.library_hero || item.assets.library_hero_2x),
                header: assetUrl(item.assets, item.assets.header),
            };
        }
    }
    return artwork;
}

module.exports = { fetchGameArtwork };
