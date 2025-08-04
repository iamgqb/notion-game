/**
 * @fileoverview Configuration for the Notion-Steam sync script.
 *
 * This file centralizes all configuration variables, loading them from environment
 * variables. It is crucial to set these environment variables for the script to run.
 * For local development, you can use a .env file.
 */

module.exports = {
    /**
     * The Notion API key for authentication.
     * Loaded from the NOTION_API_KEY environment variable.
     * @type {string}
     */
    notionApiKey: process.env.NOTION_API_KEY,

    /**
     * The ID of the Notion database to sync with.
     * Loaded from the NOTION_DATABASE_ID environment variable.
     * @type {string}
     */
    databaseId: process.env.NOTION_DATABASE_ID,

    /**
     * The Steam API key for accessing Steam services.
     * Loaded from the STEAM_KEY environment variable.
     * @type {string}
     */
    steamKey: process.env.STEAM_KEY,

    /**
     * The 64-bit Steam ID of the user whose library is to be synced.
     * Loaded from the STEAM_ID environment variable.
     * @type {string}
     */
    steamId: process.env.STEAM_ID,
};
