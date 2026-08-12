#!/usr/bin/env node

/** @author yuecheng */
async function main() {
    require('./load-env').loadEnv();
    const { getBackupConfig } = require('./backup/config');
    const { R2Storage } = require('./backup/r2-storage');
    const { runAudit } = require('./backup/service');
    const { writeSummary } = require('./backup/summary');

    const config = getBackupConfig(process.env, { requireNotion: false });
    const storage = R2Storage.fromConfig(config);
    try {
        const result = await runAudit({ config, storage });
        writeSummary('Notion → R2 每周审计', result);
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
