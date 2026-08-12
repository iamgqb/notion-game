#!/usr/bin/env node

/** @author yuecheng */
async function main() {
    require('./load-env').loadEnv();
    const { getBackupConfig } = require('./backup/config');
    const { R2Storage } = require('./backup/r2-storage');
    const { runBackup } = require('./backup/service');
    const { writeSummary } = require('./backup/summary');

    const config = getBackupConfig();
    const storage = R2Storage.fromConfig(config);
    try {
        const result = await runBackup({ config, storage });
        writeSummary('Notion → R2 备份', result);
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
