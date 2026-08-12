const { createHash } = require('crypto');
const {
    CopyObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} = require('@aws-sdk/client-s3');

/** @author yuecheng */
function isNotFound(error) {
    return (
        error?.$metadata?.httpStatusCode === 404 ||
        error?.name === 'NoSuchKey' ||
        error?.name === 'NotFound'
    );
}

/** @author yuecheng */
function isPreconditionFailed(error) {
    return (
        error?.$metadata?.httpStatusCode === 412 ||
        error?.name === 'PreconditionFailed'
    );
}

/** @author yuecheng */
async function bodyToBuffer(body) {
    if (!body) return Buffer.alloc(0);
    if (typeof body.transformToByteArray === 'function') {
        return Buffer.from(await body.transformToByteArray());
    }

    const chunks = [];
    for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * Minimal S3-compatible adapter for the object operations used by the backup.
 *
 * @author yuecheng
 */
class R2Storage {
    constructor({ client, bucket }) {
        this.client = client;
        this.bucket = bucket;
    }

    /** @author yuecheng */
    static fromConfig(config) {
        const client = new S3Client({
            region: 'auto',
            endpoint: config.r2Endpoint,
            credentials: {
                accessKeyId: config.r2AccessKeyId,
                secretAccessKey: config.r2SecretAccessKey,
            },
        });
        return new R2Storage({ client, bucket: config.r2Bucket });
    }

    /** @author yuecheng */
    async getBuffer(key) {
        try {
            const response = await this.client.send(
                new GetObjectCommand({ Bucket: this.bucket, Key: key })
            );
            return {
                body: await bodyToBuffer(response.Body),
                etag: response.ETag,
                contentType: response.ContentType,
                contentEncoding: response.ContentEncoding,
            };
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    }

    /** @author yuecheng */
    async getJson(key) {
        const object = await this.getBuffer(key);
        if (!object) return null;
        try {
            return {
                value: JSON.parse(object.body.toString('utf8')),
                etag: object.etag,
            };
        } catch (error) {
            const invalidJson = new Error(
                `R2 object ${key} is not valid JSON: ${error.message}`
            );
            invalidJson.code = 'INVALID_JSON';
            invalidJson.etag = object.etag;
            invalidJson.cause = error;
            throw invalidJson;
        }
    }

    /** @author yuecheng */
    async put(
        key,
        body,
        { contentType, contentEncoding, metadata, ifMatch, ifNoneMatch } = {}
    ) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        try {
            return await this.client.send(
                new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                    Body: buffer,
                    ContentType: contentType,
                    ContentEncoding: contentEncoding,
                    Metadata: metadata,
                    ChecksumSHA256: createHash('sha256')
                        .update(buffer)
                        .digest('base64'),
                    IfMatch: ifMatch,
                    IfNoneMatch: ifNoneMatch,
                })
            );
        } catch (error) {
            if (isPreconditionFailed(error)) {
                const conflict = new Error(`Conditional write failed for ${key}`);
                conflict.code = 'CONDITIONAL_WRITE_CONFLICT';
                conflict.cause = error;
                throw conflict;
            }
            throw error;
        }
    }

    /** @author yuecheng */
    async copy(sourceKey, destinationKey) {
        const encodedSource = `/${this.bucket}/${sourceKey
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`;
        return this.client.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                Key: destinationKey,
                CopySource: encodedSource,
            })
        );
    }

    /** @author yuecheng */
    async listKeys(prefix) {
        const keys = [];
        let continuationToken;
        do {
            const response = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                })
            );
            keys.push(
                ...(response.Contents ?? []).flatMap((item) => item.Key ?? [])
            );
            continuationToken = response.IsTruncated
                ? response.NextContinuationToken
                : undefined;
            if (response.IsTruncated && !continuationToken) {
                throw new Error(
                    'R2 list response is truncated without a continuation token'
                );
            }
        } while (continuationToken);
        return keys;
    }

    /** @author yuecheng */
    async deleteKeys(keys) {
        for (let index = 0; index < keys.length; index += 1000) {
            const batch = keys.slice(index, index + 1000);
            if (batch.length === 0) continue;
            const response = await this.client.send(
                new DeleteObjectsCommand({
                    Bucket: this.bucket,
                    Delete: {
                        Quiet: true,
                        Objects: batch.map((Key) => ({ Key })),
                    },
                })
            );
            if (response.Errors?.length) {
                const details = response.Errors.map(
                    (error) => `${error.Key}: ${error.Code} ${error.Message ?? ''}`
                ).join('; ');
                throw new Error(`R2 failed to delete objects: ${details}`);
            }
        }
    }

    /** @author yuecheng */
    async deletePrefix(prefix) {
        const keys = await this.listKeys(prefix);
        await this.deleteKeys(keys);
        return keys.length;
    }

    /** @author yuecheng */
    destroy() {
        this.client.destroy?.();
    }
}

module.exports = { R2Storage, bodyToBuffer, isNotFound, isPreconditionFailed };
