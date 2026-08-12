const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_ACCOUNT_ID,
    DEFAULT_BUCKET,
    getBackupConfig,
} = require('../src/backup/config');

test('备份配置默认使用既有 R2 Bucket', () => {
    const config = getBackupConfig({
        NOTION_API_KEY: 'notion',
        NOTION_DATABASE_ID: 'games',
        HISTORY_DATABASE_ID: 'history',
        R2_ACCESS_KEY_ID: 'access',
        R2_SECRET_ACCESS_KEY: 'secret',
    });

    assert.equal(config.r2AccountId, DEFAULT_ACCOUNT_ID);
    assert.equal(config.r2Bucket, DEFAULT_BUCKET);
    assert.equal(
        config.r2Endpoint,
        `https://${DEFAULT_ACCOUNT_ID}.r2.cloudflarestorage.com`
    );
});

test('每周审计不要求 Notion 凭证', () => {
    assert.doesNotThrow(() =>
        getBackupConfig(
            {
                R2_ACCESS_KEY_ID: 'access',
                R2_SECRET_ACCESS_KEY: 'secret',
            },
            { requireNotion: false }
        )
    );
});

test('每日备份缺少 Notion 凭证时拒绝运行', () => {
    assert.throws(
        () =>
            getBackupConfig({
                R2_ACCESS_KEY_ID: 'access',
                R2_SECRET_ACCESS_KEY: 'secret',
            }),
        /notionApiKey, databaseId, historyDatabaseId/
    );
});
