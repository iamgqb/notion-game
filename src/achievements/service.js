const { createHash } = require('node:crypto');
const { fetchAchievementDetails } = require('./steam-source');

const ACHIEVEMENT_CACHE_KEY = 'state/steam-achievements.json';
const CACHE_FORMAT_VERSION = 1;
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

function eligibleGames(games) {
    const unique = new Map();
    for (const game of games) {
        if (!Number.isSafeInteger(game.appid) || game.appid <= 0) continue;
        const previous = unique.get(game.appid);
        const selected = !previous || (game.play_time ?? 0) > (previous.play_time ?? 0) ? game : previous;
        unique.set(game.appid, { ...selected, favorite: Boolean(previous?.favorite || game.favorite) });
    }
    return [...unique.values()]
        .filter((game) => game.play_time > 0 || game.favorite || game.achievement > 0)
        .sort((a, b) => a.appid - b.appid);
}

function isGameData(data) {
    return data && ['available', 'no_achievements'].includes(data.status) &&
        Array.isArray(data.achievements) && data.achievements.every((a) =>
            typeof a?.id === 'string' && typeof a.name === 'string' &&
            (a.unlocked === null || typeof a.unlocked === 'boolean') &&
            (a.globalPercent === null || (Number.isFinite(a.globalPercent) && a.globalPercent >= 0 && a.globalPercent <= 100)));
}

function publicAchievementData(cache, candidates) {
    const games = [];
    let noAchievements = 0;
    for (const game of candidates) {
        const entry = cache.entries[game.appid];
        if (!isGameData(entry?.data)) continue;
        if (entry.data.status === 'no_achievements') { noAchievements++; continue; }
        if (!entry.data.achievements.length) continue;
        games.push({
            appid: game.appid,
            name: game.name,
            updatedAt: entry.dataUpdatedAt,
            achievements: entry.data.achievements,
        });
    }
    return {
        updatedAt: games.map((game) => game.updatedAt).filter(Boolean).sort().at(-1) ?? null,
        coverage: {
            eligibleGames: candidates.length,
            gamesWithData: games.length,
            noAchievements,
            unavailableGames: candidates.length - games.length - noAchievements,
        },
        games,
    };
}

async function refreshAchievements({
    games, cache = null, steamKey, steamId, now = new Date(),
    fetchDetails = fetchAchievementDetails, concurrency = 3,
    refreshMs = REFRESH_MS, retryMs = RETRY_MS, onProgress = () => {},
}) {
    if (!steamKey || !steamId) throw new Error('Steam achievement synchronization requires STEAM_KEY and STEAM_ID');
    const accountHash = createHash('sha256').update(String(steamId)).digest('hex');
    const validCache = cache?.formatVersion === CACHE_FORMAT_VERSION && cache.accountHash === accountHash &&
        cache.entries && typeof cache.entries === 'object' && !Array.isArray(cache.entries);
    const next = { formatVersion: CACHE_FORMAT_VERSION, accountHash, entries: { ...(validCache ? cache.entries : {}) } };
    const candidates = eligibleGames(games);
    const timestamp = now.toISOString();
    const pending = candidates.filter((game) => {
        const entry = next.entries[game.appid];
        const playTime = game.play_time ?? 0;
        if (!entry) return true;
        const recentlyFailed = entry.attemptedPlayTime === playTime && entry.attemptedAt &&
            now.getTime() - Date.parse(entry.attemptedAt) < retryMs;
        if (recentlyFailed) return false;
        return !isGameData(entry.data) || entry.playTimeMinutes !== playTime ||
            !Number.isFinite(Date.parse(entry.dataUpdatedAt)) ||
            !Number.isFinite(Date.parse(entry.checkedAt)) || now.getTime() - Date.parse(entry.checkedAt) >= refreshMs;
    });
    let index = 0;
    let completed = 0;
    let failed = 0;
    const warnings = [];
    async function worker() {
        while (index < pending.length) {
            const game = pending[index++];
            const previous = next.entries[game.appid];
            try {
                const data = await fetchDetails({ steamKey, steamId, appid: game.appid, previous: previous?.data });
                if (!isGameData(data)) throw new Error('Invalid achievement data');
                const same = JSON.stringify(previous?.data) === JSON.stringify(data);
                next.entries[game.appid] = {
                    playTimeMinutes: game.play_time ?? 0,
                    checkedAt: timestamp,
                    dataUpdatedAt: same && Number.isFinite(Date.parse(previous?.dataUpdatedAt)) ? previous.dataUpdatedAt : timestamp,
                    data,
                };
            } catch (error) {
                failed++;
                next.entries[game.appid] = {
                    ...previous,
                    attemptedAt: timestamp,
                    attemptedPlayTime: game.play_time ?? 0,
                };
                warnings.push({ appid: game.appid, code: error.code || 'ACHIEVEMENTS_UNAVAILABLE' });
            }
            onProgress({ completed: ++completed, total: pending.length, failed });
        }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), 6, pending.length) }, worker));
    // Drop games removed from this library, without sharing cached player data across accounts.
    const currentIds = new Set(candidates.map((game) => String(game.appid)));
    for (const appid of Object.keys(next.entries)) if (!currentIds.has(appid)) delete next.entries[appid];
    const data = publicAchievementData(next, candidates);
    if (failed > 0 && data.games.length === 0) {
        throw new Error('Steam achievements unavailable for every requested game; refusing to publish an empty replacement');
    }
    return {
        cache: next,
        data,
        changed: JSON.stringify(cache) !== JSON.stringify(next),
        refreshed: pending.length - failed,
        failed,
        warnings,
    };
}

async function loadAchievementData({ storage, ...options }) {
    let previous;
    try { previous = await storage.getJson(ACHIEVEMENT_CACHE_KEY); }
    catch (error) {
        if (error.code !== 'INVALID_JSON') throw error;
        previous = { value: null, etag: error.etag };
    }
    const result = await refreshAchievements({ ...options, cache: previous?.value });
    if (result.changed) {
        await storage.put(ACHIEVEMENT_CACHE_KEY, `${JSON.stringify(result.cache)}\n`, {
            contentType: 'application/json; charset=utf-8',
            ...(previous?.etag ? { ifMatch: previous.etag } : { ifNoneMatch: '*' }),
        });
    }
    return result;
}

module.exports = { ACHIEVEMENT_CACHE_KEY, eligibleGames, loadAchievementData, publicAchievementData, refreshAchievements };
