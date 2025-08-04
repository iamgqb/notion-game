/**
 * @fileoverview A module for interacting with the Notion API.
 *
 * This provides a set of functions to abstract away the details of making
 * requests to the Notion API, including authentication, error handling,
 * and request body construction. It supports querying databases, creating pages,
 * and updating pages.
 */

/**
 * A generic helper function to make requests to the Notion API.
 * It handles authentication, request formatting, and error handling.
 *
 * @param {string} notionApiKey - The Notion API key.
 * @param {string} path - The API endpoint path (e.g., '/pages', '/databases/:id/query').
 * @param {'POST' | 'PATCH' | 'GET' | 'DELETE'} method - The HTTP method.
 * @param {object} [body] - The request body for POST or PATCH requests.
 * @returns {Promise<object|null>} A promise that resolves to the JSON response body, or null if the response has no content.
 * @throws {Error} Throws an error if the API request fails.
 */
async function notionApiRequest(notionApiKey, path, method, body) {
    const url = `https://api.notion.com/v1${path}`;
    const headers = {
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
    };

    const options = {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    };

    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            // Attempt to parse the error response for more details.
            const errorBody = await response.json().catch(() => response.text());
            console.error(`Notion API Error (${response.status}):`, errorBody);
            throw new Error(`Notion API request failed with status ${response.status}.`);
        }

        // Handle responses with no content (e.g., 204 No Content).
        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`Failed to execute Notion API request for ${method} ${path}:`, error.message);
        // Re-throw the error to be handled by the caller.
        throw error;
    }
}

/**
 * Queries a Notion database to retrieve its pages.
 *
 * @param {string} notionApiKey - The Notion API key.
 * @param {string} databaseId - The ID of the database to query.
 * @param {object} [params={}] - Additional query parameters (e.g., for pagination, sorting, filtering).
 * @returns {Promise<object>} A promise that resolves to the query results.
 */
async function queryDatabase(notionApiKey, databaseId, params = {}) {
    console.log(`Querying Notion database (ID: ${databaseId})...`);
    return notionApiRequest(notionApiKey, `/databases/${databaseId}/query`, 'POST', params);
}

/**
 * Updates the properties of a specific page in Notion.
 *
 * @param {string} notionApiKey - The Notion API key.
 * @param {string} pageId - The ID of the page to update.
 * @param {object} data - An object containing the properties to update.
 * @returns {Promise<object>} A promise that resolves to the updated page object.
 */
async function updatePage(notionApiKey, pageId, data) {
    console.log(`Updating Notion page (ID: ${pageId})...`);
    return notionApiRequest(notionApiKey, `/pages/${pageId}`, 'PATCH', data);
}

/**
 * Creates a new page in a Notion database.
 *
 * @param {string} notionApiKey - The Notion API key.
 * @param {string} databaseId - The ID of the parent database.
 * @param {object} data - The data for the new page, including properties and cover.
 * @returns {Promise<object>} A promise that resolves to the newly created page object.
 */
async function createPage(notionApiKey, databaseId, data) {
    console.log('Creating a new page in Notion...');
    const body = {
        parent: { database_id: databaseId },
        ...data,
    };
    return notionApiRequest(notionApiKey, '/pages', 'POST', body);
}

module.exports = {
    queryDatabase,
    updatePage,
    createPage,
};