#!/usr/bin/env node

/** @author yuecheng */
async function main() {
    require('../load-env').loadEnv();
    const { getBackupConfig } = require('../backup/config');
    const { R2Storage } = require('../backup/r2-storage');
    const { writeSummary } = require('../backup/summary');
    const { markSiteDeployed } = require('./deployment');

    const required = [
        'SITE_DEPLOYMENT_HASH',
        'SITE_SOURCE_PREFIX',
        'SITE_SOURCE_CONTENT_HASH',
        'SITE_SOURCE_SNAPSHOT_COMPLETED_AT',
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`Missing site deployment state: ${missing.join(', ')}`);
    }

    const config = getBackupConfig(process.env, { requireNotion: false });
    const storage = R2Storage.fromConfig(config);
    try {
        const result = await markSiteDeployed({
            storage,
            deploymentHash: process.env.SITE_DEPLOYMENT_HASH,
            sourcePrefix: process.env.SITE_SOURCE_PREFIX,
            sourceContentHash: process.env.SITE_SOURCE_CONTENT_HASH,
            snapshotCompletedAt:
                process.env.SITE_SOURCE_SNAPSHOT_COMPLETED_AT,
            gitSha: process.env.GITHUB_SHA,
        });
        writeSummary('Cloudflare Workers 部署状态', result);
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
