const STEAM_API = 'https://api.steampowered.com/ISteamUserStats/';

function steamError(code, message, status = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

async function requestSteam(method, version, parameters, {
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxAttempts = 3,
} = {}) {
    const url = new URL(`${method}/${version}/`, STEAM_API);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let response;
        try {
            response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(15000) });
        } catch {
            if (attempt + 1 < maxAttempts) {
                await sleep(500 * 2 ** attempt);
                continue;
            }
            // Never include a request URL: it contains the Steam API key.
            throw steamError('STEAM_NETWORK', `${method}: request failed`);
        }
        if (response.ok) {
            try { return await response.json(); }
            catch { throw steamError('STEAM_RESPONSE', `${method}: invalid JSON`); }
        }
        if ((response.status === 429 || response.status >= 500) && attempt + 1 < maxAttempts) {
            const retryAfter = Number(response.headers?.get('retry-after'));
            await sleep(Math.min(5000, Math.max(500, retryAfter * 1000 || 500 * 2 ** attempt)));
            continue;
        }
        throw steamError('STEAM_HTTP', `${method}: HTTP ${response.status}`, response.status);
    }
}

function imageUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch { return null; }
}

function unlockDate(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    const date = new Date(timestamp * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fetchAchievementDetails({ steamKey, steamId, appid, previous = null, ...options }) {
    const schema = await requestSteam('GetSchemaForGame', 'v2', {
        key: steamKey, appid, l: 'schinese',
    }, options);
    if (!schema?.game || typeof schema.game !== 'object') {
        throw steamError('STEAM_SCHEMA', `Game ${appid}: schema unavailable`);
    }
    const definitions = schema.game.availableGameStats?.achievements ?? [];
    if (!Array.isArray(definitions) || definitions.some((a) => typeof a?.name !== 'string')) {
        throw steamError('STEAM_SCHEMA', `Game ${appid}: invalid achievement schema`);
    }
    if (!definitions.length) {
        if (previous?.achievements?.length) {
            throw steamError('STEAM_SCHEMA', `Game ${appid}: refusing to replace existing achievements with an empty schema`);
        }
        return { status: 'no_achievements', achievements: [] };
    }
    const [playerResult, globalResult] = await Promise.allSettled([
        requestSteam('GetPlayerAchievements', 'v1', {
            key: steamKey, steamid: steamId, appid, l: 'schinese',
        }, options),
        requestSteam('GetGlobalAchievementPercentagesForApp', 'v2', { gameid: appid }, options),
    ]);
    if (playerResult.status === 'rejected') throw playerResult.reason;
    const player = playerResult.value?.playerstats;
    if (player?.success === false || !Array.isArray(player?.achievements) || !player.achievements.length ||
        player.achievements.some((a) => typeof a?.apiname !== 'string' || ![0, 1].includes(a.achieved))) {
        throw steamError('STEAM_PLAYER', `Game ${appid}: player achievements unavailable`);
    }
    const players = new Map(player.achievements.map((a) => [a.apiname, a]));
    const oldPercentages = new Map((previous?.achievements ?? []).map((a) => [a.id, a.globalPercent]));
    const percentages = new Map();
    const globalAchievements = globalResult.status === 'fulfilled'
        ? globalResult.value?.achievementpercentages?.achievements : null;
    if (Array.isArray(globalAchievements)) {
        for (const item of globalAchievements) {
            const value = Number(item.percent);
            if (typeof item.name === 'string' && Number.isFinite(value) && value >= 0 && value <= 100) {
                percentages.set(item.name, value);
            }
        }
    }
    return {
        status: 'available',
        achievements: definitions.map((definition) => {
            const personal = players.get(definition.name);
            const unlocked = personal ? personal.achieved === 1 : null;
            return {
                id: definition.name,
                name: definition.displayName || personal?.name || definition.name,
                description: definition.description || (unlocked ? personal?.description : '') || '',
                hidden: Boolean(Number(definition.hidden)),
                icon: imageUrl(definition.icon),
                iconGray: imageUrl(definition.icongray),
                unlocked,
                unlockedAt: unlocked ? unlockDate(personal.unlocktime) : null,
                globalPercent: percentages.get(definition.name) ?? oldPercentages.get(definition.name) ?? null,
            };
        }).sort((left, right) => left.id.localeCompare(right.id, 'en')),
    };
}

module.exports = { fetchAchievementDetails, requestSteam };
