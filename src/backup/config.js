const DEFAULT_ACCOUNT_ID = '23cbd4dde1f2b9ba631161785549d4b3';
const DEFAULT_BUCKET = 'game-record';

/** @author yuecheng */
function getBackupConfig(env = process.env, { requireNotion = true } = {}) {
    const r2AccountId = env.R2_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
    const config = {
        notionApiKey: env.NOTION_API_KEY,
        databaseId: env.NOTION_DATABASE_ID,
        historyDatabaseId: env.HISTORY_DATABASE_ID,
        r2AccountId,
        r2Bucket: env.R2_BUCKET || DEFAULT_BUCKET,
        r2Endpoint:
            env.R2_ENDPOINT ||
            `https://${r2AccountId}.r2.cloudflarestorage.com`,
        r2AccessKeyId: env.R2_ACCESS_KEY_ID,
        r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
        timeZone: env.BACKUP_TIME_ZONE || 'Asia/Singapore',
    };

    const required = [
        'r2AccountId',
        'r2Bucket',
        'r2AccessKeyId',
        'r2SecretAccessKey',
    ];
    if (requireNotion) {
        required.unshift('notionApiKey', 'databaseId', 'historyDatabaseId');
    }
    const missing = required.filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing backup configuration: ${missing.join(', ')}`);
    }

    return config;
}

module.exports = { DEFAULT_ACCOUNT_ID, DEFAULT_BUCKET, getBackupConfig };
