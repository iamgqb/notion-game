(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CheckpointSelection = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const storageKey = 'checkpoint.archive-selection.v1';

  function shuffled(items, random = Math.random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function sample(items, count, previous = [], key = item => String(item.appid), random = Math.random) {
    const pool = [...new Map(items.map(item => [key(item), item])).values()];
    const previousIds = Array.isArray(previous) ? previous : [];
    const result = shuffled(pool, random).slice(0, count);
    const ids = result.map(key);
    const sameSelection = result.length === previousIds.length && ids.every(id => previousIds.includes(id));
    if (sameSelection) {
      const alternative = shuffled(pool, random).find(item => !ids.includes(key(item)));
      if (alternative && result.length) result[result.length - 1] = alternative;
      else if (result.length > 1 && ids.every((id, index) => id === previousIds[index])) {
        [result[0], result[1]] = [result[1], result[0]];
      }
    }
    return result;
  }

  function selectArchive({ games, achievementGames, achievements, storage, random = Math.random }) {
    let previous = {};
    try {
      storage ??= globalThis.sessionStorage;
      const value = JSON.parse(storage?.getItem(storageKey) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) previous = value;
    } catch { /* Selection remains usable when storage is blocked or corrupt. */ }
    const favorites = games.filter(game => game.favorite);
    const withAchievements = favorites.filter(game => achievementGames.get(game.appid)?.achievements.some(a => a.unlocked));
    const heroPool = withAchievements.length ? withAchievements : favorites.length ? favorites : games.filter(game => game.playTimeMinutes > 0);
    const choose = (items, count, last, key) => sample(items, count, last, key, random);
    const hero = choose(heroPool.length ? heroPool : games, 1, previous.hero)[0];
    const picks = choose(favorites, 6, previous.favorites);
    const completed = choose(games.filter(game => game.achievementRate === 1), 6, previous.completed);
    const memories = choose(games.filter(game => game.lastPlayed), 3, previous.memories);
    const rareByGame = new Map();
    for (const achievement of achievements) {
      if (!achievement.unlocked || !Number.isFinite(achievement.globalPercent) || achievement.globalPercent > 5) continue;
      const group = rareByGame.get(achievement.appid) ?? [];
      group.push(achievement);
      rareByGame.set(achievement.appid, group);
    }
    const previousRare = Array.isArray(previous.rare) ? previous.rare : [];
    const rare = shuffled([...rareByGame.values()], random).slice(0, 3).map(group => {
      const previousForGame = previousRare.filter(key => group.some(a => a.key === key));
      return choose(group, 1, previousForGame, a => a.key)[0];
    });
    try {
      storage?.setItem(storageKey, JSON.stringify({
        hero: hero ? [String(hero.appid)] : [],
        favorites: picks.map(game => String(game.appid)),
        completed: completed.map(game => String(game.appid)),
        memories: memories.map(game => String(game.appid)),
        rare: rare.map(a => a.key),
      }));
    } catch { /* Random selection works without persistence. */ }
    return { hero, picks, completed, memories, rare };
  }

  return { sample, selectArchive };
});
