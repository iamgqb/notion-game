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
function buildSiteData(games, history, generatedAt = new Date()) {
    const historyByAppId = new Map();
    const recentCutoff = generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000;

    for (const record of history) {
        if (!Number.isFinite(record.appid)) continue;
        const list = historyByAppId.get(record.appid) ?? [];
        list.push(record);
        historyByAppId.set(record.appid, list);
    }

    const siteGames = games.map((game) => {
        const records = (historyByAppId.get(game.appid) ?? []).sort(
            (left, right) =>
                new Date(dateStart(right.date) ?? 0).getTime() -
                new Date(dateStart(left.date) ?? 0).getTime()
        );
        const lastRecord = records[0];
        const recentMinutes = records.reduce((total, record) => {
            const timestamp = new Date(dateStart(record.date) ?? 0).getTime();
            return timestamp >= recentCutoff ? total + (record.time ?? 0) : total;
        }, 0);

        return {
            name: game.name,
            appid: game.appid,
            playTimeMinutes: game.play_time ?? 0,
            achievementRate: game.achievement,
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
    };
}

/** @author yuecheng */
function writeSiteData(
    games,
    history,
    generatedAt = new Date(),
    outputPath = path.resolve(__dirname, '../../site/data.js')
) {
    const data = buildSiteData(games, history, generatedAt);
    const output = `window.NOTION_GAME_DATA = ${JSON.stringify(data)};\n`;
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
    const { data, outputPath } = writeSiteData(
        normalizeGames(gamePages),
        normalizeHistory(historyPages)
    );
    console.log(
        `已只读导出 ${data.meta.counts.games} 款游戏和 ` +
            `${data.meta.counts.history} 条历史记录到 ${outputPath}`
    );
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildSiteData, writeSiteData };
