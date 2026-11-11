(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CheckpointRecent = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const dayMs = 86_400_000;
  const calendarDay = value => String(value ?? '').slice(0, 10);
  const singaporeToday = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const duration = minutes => {
    const rounded = Math.round(minutes);
    const hours = Math.floor(rounded / 60);
    const rest = rounded % 60;
    return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ''}` : `${rest} 分钟`;
  };

  function selectRecentGame(games, history, today = singaporeToday()) {
    const end = Date.parse(`${calendarDay(today)}T00:00:00Z`);
    if (!Number.isFinite(end)) return null;
    const start = end - 6 * dayMs;
    const gameMap = new Map(games.map(game => [Number(game.appid), game]));
    const totals = new Map();
    for (const record of history) {
      const appid = Number(record.appid);
      const date = calendarDay(record.date);
      const stamp = Date.parse(`${date}T00:00:00Z`);
      if (!gameMap.has(appid) || !Number.isFinite(stamp) || stamp < start || stamp > end || !Number.isFinite(record.minutes) || record.minutes <= 0) continue;
      const entry = totals.get(appid) || { appid, recentMinutes: 0, lastDate: '' };
      entry.recentMinutes += record.minutes;
      if (date > entry.lastDate) entry.lastDate = date;
      totals.set(appid, entry);
    }
    const selected = [...totals.values()].sort((a, b) => b.recentMinutes - a.recentMinutes || b.lastDate.localeCompare(a.lastDate) || a.appid - b.appid)[0];
    return selected ? { ...selected, game: gameMap.get(selected.appid), startDate: new Date(start).toISOString().slice(0, 10), endDate: calendarDay(today) } : null;
  }

  function render({ games, history, today, imageSources }) {
    const section = document.getElementById('currently-playing');
    const selection = selectRecentGame(games, history, today);
    section.hidden = !selection;
    const randomFeature = document.querySelector('.feature');
    if (!selection) {
      section.after(randomFeature);
      randomFeature.classList.remove('secondary-feature');
      return;
    }
    const { game } = selection;
    document.getElementById('playing-title').textContent = game.name;
    document.getElementById('playing-duration').textContent = duration(selection.recentMinutes);
    document.getElementById('playing-window').textContent = `${selection.startDate.slice(5).replace('-', '.')} — ${selection.endDate.slice(5).replace('-', '.')}`;
    document.getElementById('playing-last-record').textContent = `最后记录 ${selection.lastDate.replaceAll('-', '.')}`;
    document.getElementById('playing-open').dataset.openGame = game.appid;
    const image = document.getElementById('playing-image');
    image.dataset.gameAppid = game.appid;
    image.alt = `${game.name}游戏主视觉`;
    image.src = imageSources(game.appid, game.artwork, 'hero')[0];
    document.querySelector('section[aria-labelledby="favorites-title"]').after(randomFeature);
    randomFeature.classList.add('secondary-feature');
  }
  return { selectRecentGame, duration, render };
});
