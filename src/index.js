/**
 * @fileoverview Main script for synchronizing Steam game data to a Notion database.
 *
 * This script orchestrates the process of fetching game data from the Steam API
 * and synchronizing it with a Notion database. It handles:
 * - Fetching all owned games from a Steam account.
 * - Fetching all existing game entries from a Notion database.
 * - Comparing the two lists and either creating new entries in Notion or updating existing ones.
 * - Updating includes changes to playtime and achievement completion rates.
 */

// Manually load environment variables from the .env file for local development.
// This avoids using external libraries like 'dotenv'.
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envFileContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFileContent.split('\n')) {
        const trimmedLine = line.trim();
        // Ignore comments and empty lines.
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            const value = valueParts.join('=').trim();
            if (key) {
                // Set the environment variable, removing quotes from the value if present.
                process.env[key.trim()] = value.replace(/^['|"](.*)['|"]$/, '$1');
            }
        }
    }
}

const notion = require("./notion");
const { getOwnedGames, getGameAchievements, getSteamBuyData } = require("./steam");
const config = require("./config");

/**
 * Fetches all pages from a Notion database, automatically handling pagination.
 *
 * @returns {Promise<Array<object>>} A promise that resolves to an array of all page objects in the database.
 */
async function getAllDatabasePages() {
    const results = [];
    let nextCursor;

    do {
        const response = await notion.queryDatabase(
            config.notionApiKey,
            config.databaseId,
            {
                start_cursor: nextCursor,
            }
        );
        results.push(...response.results);
        nextCursor = response.next_cursor;
    } while (nextCursor);

    return results;
}

/**
 * Synchronizes owned games from Steam to the Notion database.
 * This function adds new games and updates existing ones if their playtime or name has changed.
 * When playtime is updated, it also refreshes the achievement completion rate.
 */
async function syncSteamGamesToNotion() {
    console.log("Starting Steam to Notion synchronization...");

    // 1. Fetch data from both Steam and Notion concurrently for efficiency.
    const [steamGames, notionPages] = await Promise.all([
        getOwnedGames(config.steamKey, config.steamId),
        getAllDatabasePages(),
    ]);
    console.log(
        `Found ${Object.keys(steamGames).length} games on Steam and ${notionPages.length} pages in Notion.`
    );

    // 2. Create a map of Notion pages by appid for efficient lookups.
    const notionAppIdMap = notionPages.reduce((map, page) => {
        const appid = page.properties?.appid?.number;
        if (appid) {
            map[appid] = page;
        }
        return map;
    }, {});

    // 3. Iterate over each Steam game and sync its data to Notion.
    for (const appid in steamGames) {
        const game = steamGames[appid];
        const existingPage = notionAppIdMap[appid];

        try {
            if (existingPage) {
                await updateExistingGamePage(game, existingPage);
            } else {
                await createNewGamePage(game);
            }
        } catch (error) {
            // Log errors for individual games without stopping the entire sync process.
            console.error(`Failed to sync page for ${game.name} (appid: ${appid})`, error);
        }
    }

    console.log("Synchronization complete.");
}

/**
 * Updates an existing game page in Notion if necessary.
 *
 * @param {object} game - The game object from the Steam API.
 * @param {object} page - The corresponding page object from the Notion API.
 */
async function updateExistingGamePage(game, page) {
    const propertiesToUpdate = {};
    const { properties: existingProperties } = page;

    // Check if the game's name has changed.
    if (existingProperties?.name?.title[0]?.text?.content !== game.name) {
        propertiesToUpdate.name = { title: [{ text: { content: game.name } }] };
    }

    // Check if playtime has changed, and if so, update achievements too.
    if (existingProperties?.play_time?.number !== game.playtime_forever) {
        propertiesToUpdate.play_time = { number: game.playtime_forever };

        const { completionRate } = await getGameAchievements(config.steamKey, config.steamId, game.appid);
        // Only update achievements if the rate is valid (not -1) and has changed.
        if (completionRate !== -1 && existingProperties?.achievement?.number !== completionRate) {
            propertiesToUpdate.achievement = { number: completionRate };
        }
    }

    // If there are properties to update, call the Notion API.
    if (Object.keys(propertiesToUpdate).length > 0) {
        console.log(`Updating ${game.name}...`);
        await notion.updatePage(config.notionApiKey, page.id, { properties: propertiesToUpdate });
    }
}

/**
 * Creates a new game page in the Notion database.
 *
 * @param {object} game - The game object from the Steam API.
 */
async function createNewGamePage(game) {
    console.log(`Adding new game to Notion: ${game.name}`);
    const { completionRate } = await getGameAchievements(config.steamKey, config.steamId, game.appid);

    const properties = {
        appid: { number: game.appid },
        name: { title: [{ text: { content: game.name } }] },
        play_time: { number: game.playtime_forever },
    };

    // Only add the achievement property if the completion rate is valid.
    if (completionRate !== -1) {
        properties.achievement = { number: completionRate };
    }

    const pageData = {
        properties,
        cover: {
            external: {
                url: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
            },
        },
    };

    await notion.createPage(config.notionApiKey, config.databaseId, pageData);
}

/**
 * Validates that all required configuration values are present.
 * If any are missing, it logs an error and exits the process.
 */
function validateConfig() {
    const requiredKeys = ['notionApiKey', 'databaseId', 'steamKey', 'steamId'];
    const missingKeys = requiredKeys.filter(key => !config[key]);

    if (missingKeys.length > 0) {
        console.error("Missing required configuration. Please set the following environment variables:", missingKeys.join(', '));
        process.exit(1);
    }
}

/**
 * Main entry point for the script.
 * Validates configuration and then starts the synchronization process.
 */
function main() {
    validateConfig();
    syncSteamGamesToNotion().catch((error) => {
        console.error("An unexpected error occurred during the synchronization process:", error);
        process.exit(1);
    });
}

main();
