#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../load-env');
const { fetchDatabasePages } = require('../backup/notion-source');
const { normalizeGames, normalizeHistory } = require('../backup/core');

/** @author yuecheng */
function dateStart(value) {
    return value?.start ?? null;
}

/**
 * Produces the smallest useful static dataset for the site. The source queries
 * are read-only and the generated file contains normalized business fields only.
 *
 * @author yuecheng
 */
function buildSiteData(games, history, generatedAt = new Date(), achievementData = { updatedAt: null, games: [] }) {
    const historyByAppId = new Map();
    const recentCutoff = generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000;
    const uniqueGames = new Map();
    for (const game of games) {
        if (!Number.isSafeInteger(game.appid) || game.appid <= 0) continue;
        const previous = uniqueGames.get(game.appid);
        const selected = !previous || (game.play_time ?? 0) > (previous.play_time ?? 0) ? game : previous;
        uniqueGames.set(game.appid, {
            ...selected,
            favorite: Boolean(previous?.favorite || game.favorite),
            status: [...new Set([...(previous?.status ?? []), ...(game.status ?? [])])].sort(),
        });
    }
    const detailGames = (achievementData.games ?? []).filter((game) => uniqueGames.has(game.appid));
    const detailsByAppId = new Map(detailGames.map((game) => [game.appid, game]));

    for (const record of history) {
        if (!Number.isFinite(record.appid)) continue;
        const list = historyByAppId.get(record.appid) ?? [];
        list.push(record);
        historyByAppId.set(record.appid, list);
    }

    const siteGames = [...uniqueGames.values()].map((game) => {
        const records = (historyByAppId.get(game.appid) ?? []).sort(
            (left, right) =>
                new Date(dateStart(right.date) ?? 0).getTime() -
                new Date(dateStart(left.date) ?? 0).getTime() ||
                (right.time ?? 0) - (left.time ?? 0)
        );
        const lastRecord = records[0];
        const recentMinutes = records.reduce((total, record) => {
            const timestamp = new Date(dateStart(record.date) ?? 0).getTime();
            return timestamp >= recentCutoff ? total + (record.time ?? 0) : total;
        }, 0);

        const achievements = detailsByAppId.get(game.appid)?.achievements;
        const knownPlayerState = achievements?.length && achievements.every((a) => typeof a.unlocked === 'boolean');
        const achievementRate = achievements?.length
            ? knownPlayerState ? achievements.filter((a) => a.unlocked).length / achievements.length : null
            : Number.isFinite(game.achievement) && game.achievement >= 0 && game.achievement <= 1 ? game.achievement : null;
        return {
            name: game.name,
            appid: game.appid,
            playTimeMinutes: game.play_time ?? 0,
            achievementRate,
            buyTime: dateStart(game.buy_time),
            status: game.status,
            favorite: game.favorite,
            lastPlayed: dateStart(lastRecord?.date),
            lastSessionMinutes: lastRecord?.time ?? 0,
            recentMinutes,
            historyCount: records.length,
        };
    });

    const siteHistory = history
        .map((record) => ({
            name: record.name,
            appid: record.appid,
            minutes: record.time ?? 0,
            date: dateStart(record.date),
        }))
        .filter((record) => record.date)
        .sort(
            (left, right) =>
                new Date(right.date).getTime() - new Date(left.date).getTime() ||
                right.minutes - left.minutes
        );

    return {
        meta: {
            generatedAt: generatedAt.toISOString(),
            counts: {
                games: siteGames.length,
                history: siteHistory.length,
                favorite: siteGames.filter((game) => game.favorite).length,
                perfected: siteGames.filter(
                    (game) => game.achievementRate === 1
                ).length,
                played: siteGames.filter((game) => game.playTimeMinutes > 0)
                    .length,
            },
        },
        games: siteGames,
        history: siteHistory,
        achievements: { ...achievementData, games: detailGames },
    };
}

/** @author yuecheng */
function writeSiteData(
    games,
    history,
    generatedAt = new Date(),
    outputPath = path.resolve(__dirname, '../../site/data.js'),
    achievementData = { updatedAt: null, games: [] }
) {
    const data = buildSiteData(games, history, generatedAt, achievementData);
    const serialized = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    const output = `window.NOTION_GAME_DATA = ${serialized};\n`;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
    return { data, outputPath };
}

/** @author yuecheng */
async function main() {
    loadEnv();
    const config = require('../config');
    const required = [
        ['NOTION_API_KEY', config.notionApiKey],
        ['NOTION_DATABASE_ID', config.databaseId],
        ['HISTORY_DATABASE_ID', config.historyDatabaseId],
        ['STEAM_KEY', config.steamKey],
        ['STEAM_ID', config.steamId],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        throw new Error(`缺少只读导出配置：${missing.join(', ')}`);
    }

    const [gamePages, historyPages] = await Promise.all([
        fetchDatabasePages({
            notionApiKey: config.notionApiKey,
            databaseId: config.databaseId,
        }),
        fetchDatabasePages({
            notionApiKey: config.notionApiKey,
            databaseId: config.historyDatabaseId,
        }),
    ]);
    const games = normalizeGames(gamePages);
    const { refreshAchievements } = require('../achievements/service');
    const cachePath = path.resolve(__dirname, '../../.cache/steam-achievements.json');
    let cache = null;
    try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    const achievementResult = await refreshAchievements({
        games, cache, steamKey: config.steamKey, steamId: config.steamId,
        onProgress: ({ completed, total, failed }) => {
            if (completed % 10 === 0 || completed === total) console.log(`成就采集 ${completed}/${total}，暂不可用 ${failed} 款`);
        },
    });
    if (achievementResult.changed) {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(`${cachePath}.tmp`, `${JSON.stringify(achievementResult.cache)}\n`);
        fs.renameSync(`${cachePath}.tmp`, cachePath);
    }
    const { data, outputPath } = writeSiteData(games, normalizeHistory(historyPages), new Date(), undefined, achievementResult.data);
    console.log(
        `已只读导出 ${data.meta.counts.games} 款游戏和 ` +
            `${data.meta.counts.history} 条历史记录、${achievementResult.data.games.length} 款成就明细到 ${outputPath}`
    );
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildSiteData, writeSiteData };
