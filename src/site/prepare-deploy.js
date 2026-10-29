#!/usr/bin/env node

/** @author yuecheng */
async function main() {
    require('../load-env').loadEnv();
    const { getBackupConfig } = require('../backup/config');
    const { R2Storage } = require('../backup/r2-storage');
    const { writeSummary } = require('../backup/summary');
    const { appendGithubOutputs } = require('./github-output');
    const { prepareSiteDeployment } = require('./deployment');
    const { loadAchievementData } = require('../achievements/service');

    if (!process.env.STEAM_KEY || !process.env.STEAM_ID) {
        throw new Error('站点成就采集缺少 STEAM_KEY 或 STEAM_ID');
    }

    const config = getBackupConfig(process.env, { requireNotion: false });
    const storage = R2Storage.fromConfig(config);
    try {
        const result = await prepareSiteDeployment({
            storage,
            force: process.env.SITE_FORCE_DEPLOY === 'true',
            loadAchievements: async (games) => {
                const result = await loadAchievementData({
                    storage, games,
                    steamKey: process.env.STEAM_KEY,
                    steamId: process.env.STEAM_ID,
                    onProgress: ({ completed, total, failed }) => {
                        if (completed % 10 === 0 || completed === total) console.log(`成就采集 ${completed}/${total}，暂不可用 ${failed} 款`);
                    },
                });
                console.log(`已准备 ${result.data.games.length} 款游戏的成就明细，刷新 ${result.refreshed} 款，暂不可用 ${result.failed} 款`);
                return result.data;
            },
        });
        appendGithubOutputs({
            changed: result.changed,
            deployment_hash: result.deploymentHash,
            source_prefix: result.sourcePrefix,
            source_content_hash: result.sourceContentHash,
            snapshot_completed_at: result.snapshotCompletedAt,
        });
        writeSummary('R2 → Cloudflare Workers 构建', result);
    } finally {
        storage.destroy();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { main };
