/**
 * @fileoverview A module for interacting with the Steam API.
 *
 * This provides functions to fetch a user's owned games and the achievement
 * status for a specific game. It handles API errors gracefully and formats
 * the data for use in the synchronization script.
 */

/**
 * Fetches the list of all games owned by a Steam user.
 *
 * @param {string} steamKey - The Steam API key.
 * @param {string} steamId - The user's 64-bit Steam ID.
 * @returns {Promise<Object<string, Object>>} A promise that resolves to an object where keys are app IDs
 * and values are the game objects from the Steam API.
 */
async function getOwnedGames(steamKey, steamId) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${steamKey}&steamid=${steamId}&format=json&include_appinfo=true&language=schinese&include_extended_appinfo=true&include_free_sub=true`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    if (!data.response || !Array.isArray(data.response.games)) {
      console.warn('No games data found in Steam API response.');
      return {};
    }

    // Convert the array of games to an object keyed by appid for efficient lookups.
    return data.response.games.reduce((acc, game) => {
      acc[game.appid] = game;
      return acc;
    }, {});
  } catch (error) {
    console.error('Error fetching owned games from Steam:', error);
    return {}; // Return an empty object on failure to prevent crashes.
  }
}

/**
 * Fetches player achievements for a specific game and calculates the completion rate.
 *
 * @param {string} steamKey - The Steam API key.
 * @param {string} steamId - The user's 64-bit Steam ID.
 * @param {string} appId - The app ID of the game.
 * @returns {Promise<{achievements: Array<Object>, completionRate: number}>} A promise that resolves to an object
 * containing the list of achievements and the completion rate (0 to 1). Returns a completion rate of -1
 * if the game has no achievements or if stats are not available.
 */
async function getGameAchievements(steamKey, steamId, appId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${steamKey}&steamid=${steamId}&appid=${appId}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // A 400 error from this API often means the user has no stats for the game or the game has no achievements.
      if (response.status === 400) {
        const errorData = await response.json().catch(() => null);
        if (errorData?.playerstats?.error) {
          console.warn(`Steam API notice for app ${appId}: ${errorData.playerstats.error}`);
        }
        // This is an expected case for games without achievements, so return a specific value.
        return { achievements: [], completionRate: -1 };
      }
      // For other unexpected errors, throw to be caught by the main catch block.
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.playerstats || !Array.isArray(data.playerstats.achievements)) {
      console.warn(`No achievements data found for app ${appId}.`);
      return { achievements: [], completionRate: -1 };
    }

    const { achievements } = data.playerstats;
    const totalAchievements = achievements.length;

    if (totalAchievements === 0) {
      return { achievements: [], completionRate: -1 }; // No achievements for this game.
    }

    const achievedCount = achievements.filter(ach => ach.achieved === 1).length;
    const completionRate = achievedCount / totalAchievements;

    return { achievements, completionRate };
  } catch (error) {
    console.error(`Error fetching achievements for app ${appId} from Steam:`, error);
    // Return a default value in case of unexpected network or parsing errors.
    return { achievements: [], completionRate: -1 };
  }
}

module.exports = {
  getOwnedGames,
  getGameAchievements,
};
