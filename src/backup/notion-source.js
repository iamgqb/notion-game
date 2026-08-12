const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** @author yuecheng */
function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Queries one Notion page with rate-limit and transient server error handling.
 *
 * @author yuecheng
 */
async function queryPage({
    notionApiKey,
    databaseId,
    startCursor,
    fetchImpl = fetch,
    sleep = wait,
    maxAttempts = 5,
}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response;
        try {
            response = await fetchImpl(
                `${NOTION_API_BASE}/databases/${databaseId}/query`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${notionApiKey}`,
                        'Notion-Version': NOTION_VERSION,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        page_size: 100,
                        ...(startCursor ? { start_cursor: startCursor } : {}),
                    }),
                }
            );
        } catch (error) {
            if (attempt < maxAttempts) {
                await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
                continue;
            }
            throw new Error(
                `Notion query failed for database ${databaseId}: ${error.message}`,
                { cause: error }
            );
        }

        if (response.ok) {
            return response.json();
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxAttempts) {
            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfter = Number(retryAfterHeader);
            const delay =
                retryAfterHeader !== null && Number.isFinite(retryAfter)
                    ? retryAfter * 1000
                : Math.min(1000 * 2 ** (attempt - 1), 8000);
            await sleep(delay);
            continue;
        }

        const detail = await response.text().catch(() => '');
        throw new Error(
            `Notion query failed for database ${databaseId}: HTTP ${response.status}${
                detail ? ` ${detail}` : ''
            }`
        );
    }

    throw new Error(`Notion query exhausted retries for database ${databaseId}`);
}

/** @author yuecheng */
async function fetchDatabasePages(options) {
    const pages = [];
    let startCursor;

    do {
        const response = await queryPage({ ...options, startCursor });
        if (!Array.isArray(response.results)) {
            throw new Error('Notion query response does not contain a results array');
        }
        pages.push(...response.results);
        startCursor = response.has_more ? response.next_cursor : undefined;
        if (response.has_more && !startCursor) {
            throw new Error('Notion query response has_more without next_cursor');
        }
    } while (startCursor);

    return pages;
}

module.exports = { fetchDatabasePages, queryPage };
