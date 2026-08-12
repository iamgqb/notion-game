const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('crypto');
const { CopyObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { R2Storage } = require('../src/backup/r2-storage');

test('R2 PutObject 携带 SHA-256 和条件写头', async () => {
    let command;
    const storage = new R2Storage({
        bucket: 'game-record',
        client: {
            send: async (value) => {
                command = value;
                return { ETag: '"new"' };
            },
        },
    });

    await storage.put('state/latest.json', 'content', {
        ifMatch: '"old"',
        contentType: 'application/json',
    });

    assert.equal(command.constructor.name, 'PutObjectCommand');
    assert.equal(command.input.IfMatch, '"old"');
    assert.equal(command.input.ContentType, 'application/json');
    assert.equal(
        command.input.ChecksumSHA256,
        createHash('sha256').update('content').digest('base64')
    );
});

test('R2 CopyObject 对源对象键逐段编码并发送前导斜杠', async () => {
    let command;
    const storage = new R2Storage({
        bucket: 'game-record',
        client: {
            send: async (value) => {
                command = value;
                return {};
            },
        },
    });

    await storage.copy('staging/run id/游戏.csv', 'snapshots/game.csv');

    assert.equal(
        command.input.CopySource,
        '/game-record/staging/run%20id/%E6%B8%B8%E6%88%8F.csv'
    );
});

test('AWS SDK 序列化后的 x-amz-copy-source 保留前导斜杠', async () => {
    let copySourceHeader;
    const client = new S3Client({
        region: 'auto',
        endpoint: 'https://example.r2.cloudflarestorage.com',
        credentials: {
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key',
        },
        requestHandler: {
            handle: async (request) => {
                copySourceHeader = request.headers['x-amz-copy-source'];
                return {
                    response: {
                        statusCode: 200,
                        headers: { 'content-type': 'application/xml' },
                        body: Buffer.from(
                            '<CopyObjectResult><ETag>&quot;x&quot;</ETag>' +
                                '<LastModified>2026-01-01T00:00:00Z</LastModified>' +
                                '</CopyObjectResult>'
                        ),
                    },
                };
            },
        },
    });

    try {
        await client.send(
            new CopyObjectCommand({
                Bucket: 'game-record',
                Key: 'snapshots/game.csv',
                CopySource:
                    '/game-record/staging/run%20id/%E6%B8%B8%E6%88%8F.csv',
            })
        );
    } finally {
        client.destroy();
    }

    assert.equal(
        copySourceHeader,
        '/game-record/staging/run%20id/%E6%B8%B8%E6%88%8F.csv'
    );
});

test('R2 412 被转换为可识别的条件写冲突', async () => {
    const storage = new R2Storage({
        bucket: 'game-record',
        client: {
            send: async () => {
                const error = new Error('precondition');
                error.$metadata = { httpStatusCode: 412 };
                throw error;
            },
        },
    });

    await assert.rejects(
        storage.put('state/latest.json', 'content', { ifNoneMatch: '*' }),
        (error) => error.code === 'CONDITIONAL_WRITE_CONFLICT'
    );
});
