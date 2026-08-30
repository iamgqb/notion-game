#!/usr/bin/env node

/** @author yuecheng */
async function main() {
    require('../load-env').loadEnv();
    const { getBackupConfig } = require('../backup/config');
    const { R2Storage } = require('../backup/r2-storage');
    const { writeSummary } = require('../backup/summary');
    const { appendGithubOutputs } = require('./github-output');
    const { prepareSiteDeployment } = require('./deployment');

    const config = getBackupConfig(process.env, { requireNotion: false });
    const storage = R2Storage.fromConfig(config);
    try {
        const result = await prepareSiteDeployment({
            storage,
            force: process.env.SITE_FORCE_DEPLOY === 'true',
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
