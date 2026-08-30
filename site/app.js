/* @author yuecheng */
(() => {
  const data = window.NOTION_GAME_DATA;
  const errorBanner = document.getElementById('data-error');
  if (!data || !Array.isArray(data.games) || !Array.isArray(data.history)) {
    errorBanner.hidden = false;
    document.querySelector('main').hidden = true;
    return;
  }

  const games = data.games;
  const history = data.history;
  const gamesByAppId = new Map(games.map((game) => [Number(game.appid), game]));
  const generatedAt = new Date(data.meta.generatedAt);
  const state = {
    view: 'showcase',
    libraryFilter: 'all',
    librarySort: 'curated',
    librarySearch: '',
    libraryPages: 1,
    timelineSearch: '',
    timelineLimit: 60,
  };

  const byRecent = (left, right) =>
    new Date(right.lastPlayed || 0).getTime() - new Date(left.lastPlayed || 0).getTime() ||
    right.playTimeMinutes - left.playTimeMinutes;
  const recentGames = games.filter((game) => game.lastPlayed).sort(byRecent);
  const favoriteGames = games
    .filter((game) => game.favorite)
    .sort((left, right) => right.playTimeMinutes - left.playTimeMinutes || byRecent(left, right));
  const perfectedGames = games
    .filter((game) => game.achievementRate === 1)
    .sort(byRecent);

  const numberFormat = new Intl.NumberFormat('zh-CN');
  const oneDecimalFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const weekdayFormat = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });

  /** @author yuecheng */
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /** @author yuecheng */
  function safeAppId(value) {
    const appid = Number(value);
    return Number.isInteger(appid) && appid > 0 ? appid : 0;
  }

  /** @author yuecheng */
  function portraitUrl(appid) {
    return `https://cdn.akamai.steamstatic.com/steam/apps/${safeAppId(appid)}/library_600x900_2x.jpg`;
  }

  /** @author yuecheng */
  function headerUrl(appid) {
    return `https://cdn.akamai.steamstatic.com/steam/apps/${safeAppId(appid)}/header.jpg`;
  }

  /** @author yuecheng */
  function formatDuration(minutes, { compact = false } = {}) {
    const value = Number(minutes) || 0;
    if (value < 60) return `${Math.max(0, Math.round(value))} 分钟`;
    const hours = value / 60;
    const formatted = hours >= 100 ? numberFormat.format(Math.round(hours)) : oneDecimalFormat.format(hours);
    return compact ? `${formatted}h` : `${formatted} 小时`;
  }

  /** @author yuecheng */
  function achievementLabel(rate) {
    return Number.isFinite(rate) ? `${Math.round(rate * 100)}%` : '无数据';
  }

  /** @author yuecheng */
  function achievementValue(rate) {
    return Number.isFinite(rate) ? Math.max(0, Math.min(100, Math.round(rate * 100))) : 0;
  }

  /** @author yuecheng */
  function relativeDate(value) {
    if (!value) return '暂无记录';
    const date = new Date(value);
    const diff = Math.floor((generatedAt.getTime() - date.getTime()) / 86400000);
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 30) return `${diff} 天前`;
    return dateFormat.format(date);
  }

  /** @author yuecheng */
  function posterImage(game, className = '') {
    const name = escapeHtml(game.name);
    return `<img class="${className}" src="${portraitUrl(game.appid)}" data-stage="portrait" data-appid-image="${safeAppId(game.appid)}" alt="${name} 封面" loading="lazy">`;
  }

  /** @author yuecheng */
  function fallbackTitle(game) {
    return '<span class="poster-fallback" aria-hidden="true"></span>';
  }

  /** @author yuecheng */
  function posterShell(game, {
    favorite = game.favorite,
    perfected = game.achievementRate === 1,
    achievement = false,
    recommendation = false,
  } = {}) {
    return `<span class="poster-shell">
      ${fallbackTitle(game)}
      ${posterImage(game)}
      ${favorite ? '<span class="favorite-badge" aria-label="喜欢">♥</span>' : ''}
      ${achievement || perfected ? posterAchievementMark(game) : ''}
      ${recommendation && game.favorite ? '<span class="poster-recommendation-mark" role="img" aria-label="喜欢">♥</span>' : ''}
    </span>`;
  }

  /** @author yuecheng */
  function gameCard(game, posterOptions) {
    const meta = posterOptions?.achievement
      ? formatDuration(game.playTimeMinutes)
      : `${formatDuration(game.playTimeMinutes)} · ${achievementLabel(game.achievementRate)}`;
    return `<button class="game-card" type="button" data-appid="${safeAppId(game.appid)}">
      ${posterShell(game, posterOptions)}
      <span class="game-card-copy">
        <strong>${escapeHtml(game.name)}</strong>
        <small>${meta}</small>
      </span>
    </button>`;
  }

  /** @author yuecheng */
  function libraryCard(game, filter) {
    const showAchievement = filter === 'all' || filter === 'favorite';
    const showRecommendation = filter === 'all' || filter === 'perfected';
    return `<button class="library-game-card" type="button" data-appid="${safeAppId(game.appid)}">
      ${posterShell(game, {
        favorite: false,
        perfected: false,
        achievement: showAchievement,
        recommendation: showRecommendation,
      })}
      <span class="library-card-body">
        <strong>${escapeHtml(game.name)}</strong>
        <span class="library-card-meta">累计 ${formatDuration(game.playTimeMinutes)}</span>
      </span>
    </button>`;
  }

  /** @author yuecheng */
  function renderSummary() {
    const totalMinutes = games.reduce((total, game) => total + game.playTimeMinutes, 0);
    const dates = [
      ...games.map((game) => game.buyTime),
      ...history.map((record) => record.date),
    ].filter(Boolean).map((value) => new Date(value).getFullYear());
    const firstYear = dates.length ? Math.min(...dates) : generatedAt.getFullYear();
    document.getElementById('archive-period').textContent = `MY STEAM ARCHIVE · ${firstYear}—${generatedAt.getFullYear()}`;
    document.getElementById('total-games').textContent = numberFormat.format(data.meta.counts.games);
    document.getElementById('total-hours').textContent = numberFormat.format(Math.round(totalMinutes / 60));
    document.getElementById('recent-count').textContent = `${recentGames.length} 款有记录`;
    document.getElementById('favorite-count').textContent = `${data.meta.counts.favorite} 款喜欢`;
    document.getElementById('perfected-count').textContent = `${data.meta.counts.perfected} 款`;
    document.getElementById('library-summary').textContent = `${data.meta.counts.games} 款游戏 · ${data.meta.counts.played} 款玩过`;
    document.getElementById('library-search').placeholder = `搜索 ${data.meta.counts.games} 款游戏`;
    document.getElementById('footer-summary').textContent = `${data.meta.counts.games} 款游戏 · ${numberFormat.format(Math.round(totalMinutes / 60))} 小时 · 只读快照`;
    document.getElementById('sync-state').textContent = `数据更新于 ${relativeDate(data.meta.generatedAt)}`;
  }

  /** @author yuecheng */
  function posterAchievementMark(game) {
    if (game.achievementRate === 1) {
      return `<span class="poster-achievement-mark is-perfect" role="img" aria-label="${escapeHtml(game.name)} 已全成就" data-label="全成就">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 12v4M9 20h6M10 16h4v4h-4z"/></svg>
      </span>`;
    }
    const hasData = Number.isFinite(game.achievementRate);
    if (!hasData) return '';
    const value = achievementValue(game.achievementRate);
    const label = `成就完成 ${value}%`;
    return `<span class="poster-achievement-mark is-ring" style="--achievement-value:${value}" role="img" aria-label="${escapeHtml(game.name)}：${label}" data-label="${label}"><span><b>${value}</b></span></span>`;
  }

  /** @author yuecheng */
  function renderRecent() {
    const container = document.getElementById('recent-grid');
    if (recentGames.length === 0) {
      container.innerHTML = '<p class="empty-state">暂无游玩历史。</p>';
      return;
    }
    container.innerHTML = recentGames.slice(0, 4).map((game) => {
      return `<button class="recent-flat-card" type="button" data-appid="${safeAppId(game.appid)}">
        <span class="recent-flat-poster">
          <span class="poster-fallback" aria-hidden="true"></span>
          <img src="${headerUrl(game.appid)}" data-stage="header" data-appid-image="${safeAppId(game.appid)}" alt="${escapeHtml(game.name)} 横幅" loading="lazy">
          ${posterAchievementMark(game)}
        </span>
        <span class="recent-flat-content">
          <time>${relativeDate(game.lastPlayed)}游玩</time>
          <strong>${escapeHtml(game.name)}</strong>
          <span class="recent-session">本次 ${formatDuration(game.lastSessionMinutes)} · 累计 ${formatDuration(game.playTimeMinutes)}</span>
        </span>
      </button>`;
    }).join('');
  }

  /** @author yuecheng */
  function renderFavorites() {
    const container = document.getElementById('favorite-grid');
    container.innerHTML = favoriteGames
      .slice(0, 7)
      .map((game) => gameCard(game, {
        favorite: false,
        perfected: false,
        achievement: true,
      }))
      .join('') || '<p class="empty-state">暂无喜欢标记。</p>';
  }

  /** @author yuecheng */
  function renderPerfected() {
    const container = document.getElementById('perfected-grid');
    container.innerHTML = perfectedGames.slice(0, 3).map((game, index) => `<button class="perfect-card" type="button" data-appid="${safeAppId(game.appid)}">
      ${posterShell(game, { favorite: false, perfected: true })}
      <span class="perfect-copy">
        <span>NO. ${String(data.meta.counts.perfected - index).padStart(3, '0')}</span>
        <h3>${escapeHtml(game.name)}</h3>
        <p>已解锁全部成就</p>
        <time>${game.lastPlayed ? `${relativeDate(game.lastPlayed)}游玩` : `累计 ${formatDuration(game.playTimeMinutes)}`}</time>
      </span>
    </button>`).join('') || '<p class="empty-state">暂无全成就游戏。</p>';
  }

  /** @author yuecheng */
  function filteredLibraryGames() {
    const query = state.librarySearch.trim().toLocaleLowerCase('zh-CN');
    const filtered = games.filter((game) => {
      if (query && !game.name.toLocaleLowerCase('zh-CN').includes(query)) return false;
      if (state.libraryFilter === 'favorite' && !game.favorite) return false;
      if (state.libraryFilter === 'perfected' && game.achievementRate !== 1) return false;
      return true;
    });
    const sorters = {
      curated: (left, right) => {
        const rank = (game) => game.favorite ? 0 : game.achievementRate === 1 ? 1 : 2;
        return rank(left) - rank(right) || right.playTimeMinutes - left.playTimeMinutes || left.name.localeCompare(right.name, 'zh-CN');
      },
      recent: byRecent,
      playtime: (left, right) => right.playTimeMinutes - left.playTimeMinutes || left.name.localeCompare(right.name, 'zh-CN'),
      achievement: (left, right) => (right.achievementRate ?? -1) - (left.achievementRate ?? -1) || right.playTimeMinutes - left.playTimeMinutes,
    };
    return filtered.sort(sorters[state.librarySort]);
  }

  /** @author yuecheng */
  function libraryColumnCount() {
    const grid = document.getElementById('library-grid');
    const template = getComputedStyle(grid).gridTemplateColumns;
    const resolvedColumns = template && template !== 'none'
      ? template.split(' ').filter(Boolean).length
      : 0;
    if (resolvedColumns > 0) return resolvedColumns;
    if (window.innerWidth <= 760) return 2;
    if (window.innerWidth <= 1020) return 4;
    return 5;
  }

  /** @author yuecheng */
  function renderLibrary() {
    const matches = filteredLibraryGames();
    const pageSize = libraryColumnCount() * 10;
    const visible = matches.slice(0, pageSize * state.libraryPages);
    document.getElementById('library-grid').innerHTML = visible.map((game) => libraryCard(game, state.libraryFilter)).join('') || '<p class="empty-state">没有符合条件的游戏。</p>';
    document.getElementById('library-result-line').textContent = `找到 ${matches.length} 款，当前显示 ${visible.length} 款`;
    document.getElementById('library-more').hidden = visible.length >= matches.length;
  }

  /** @author yuecheng */
  function filteredTimeline() {
    const query = state.timelineSearch.trim().toLocaleLowerCase('zh-CN');
    const cutoff = generatedAt.getTime() - 30 * 86400000;
    return history.filter((record) => {
      if (new Date(record.date).getTime() < cutoff) return false;
      return !query || record.name.toLocaleLowerCase('zh-CN').includes(query);
    });
  }

  /** @author yuecheng */
  function renderTimeline() {
    const matches = filteredTimeline();
    const visible = matches.slice(0, state.timelineLimit);
    const groups = new Map();
    for (const record of visible) {
      const key = record.date.slice(0, 10);
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    }
    const markup = [...groups.entries()].map(([dateKey, records]) => {
      const date = new Date(`${dateKey}T00:00:00`);
      const events = records.map((record) => {
        const game = gamesByAppId.get(Number(record.appid)) || {
          appid: record.appid,
          name: record.name,
          playTimeMinutes: 0,
          achievementRate: null,
          status: [],
          favorite: false,
        };
        return `<button class="timeline-event" type="button" data-appid="${safeAppId(record.appid)}">
          <span class="timeline-event-poster">${posterImage(game)}</span>
          <span><h3>${escapeHtml(record.name)}</h3><p>同步到一条游玩增量</p></span>
          <span class="timeline-duration"><small>本次</small><strong>${formatDuration(record.minutes)}</strong></span>
        </button>`;
      }).join('');
      return `<section class="timeline-day" aria-label="${escapeHtml(dateFormat.format(date))}">
        <time class="timeline-date" datetime="${dateKey}"><strong>${date.getDate()}</strong><span>${date.getMonth() + 1} 月 · ${weekdayFormat.format(date)}</span></time>
        <div class="timeline-events">${events}</div>
      </section>`;
    }).join('');
    document.getElementById('timeline-list').innerHTML = markup || '<p class="empty-state">这个范围内没有游玩记录。</p>';
    document.getElementById('timeline-count').textContent = `近 30 天 · ${matches.length} 条记录`;
    document.getElementById('timeline-more').hidden = visible.length >= matches.length;
  }

  /** @author yuecheng */
  function setLibraryFilter(filter) {
    state.libraryFilter = filter;
    state.libraryPages = 1;
    document.querySelectorAll('[data-filter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    });
    renderLibrary();
  }

  /** @author yuecheng */
  function showView(view, { updateHash = true } = {}) {
    if (!['showcase', 'timeline', 'library'].includes(view)) view = 'showcase';
    state.view = view;
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    document.querySelectorAll('.primary-nav [data-view-target]').forEach((button) => {
      if (button.dataset.viewTarget === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (view === 'library') renderLibrary();
    if (view === 'timeline') renderTimeline();
    if (updateHash) window.history.replaceState(null, '', `#${view}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** @author yuecheng */
  function openGameDialog(appid) {
    const game = gamesByAppId.get(Number(appid));
    if (!game) return;
    const dialog = document.getElementById('game-dialog');
    document.getElementById('dialog-title').textContent = game.name;
    document.getElementById('dialog-kicker').textContent = `STEAM APP ${game.appid}`;
    document.getElementById('dialog-poster').innerHTML = `${fallbackTitle(game)}${posterImage(game)}${game.favorite ? '<span class="favorite-badge" aria-label="喜欢">♥</span>' : ''}${game.achievementRate === 1 ? '<span class="perfect-badge">100%</span>' : ''}`;
    document.getElementById('dialog-stats').innerHTML = [
      ['累计游玩', formatDuration(game.playTimeMinutes)],
      ['成就进度', achievementLabel(game.achievementRate)],
      ['最近游玩', relativeDate(game.lastPlayed)],
      ['历史记录', `${game.historyCount} 条`],
    ].map(([label, value]) => `<div class="dialog-stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    document.getElementById('dialog-progress-bar').style.width = `${achievementValue(game.achievementRate)}%`;
    const tags = [
      ...(game.favorite ? ['<span class="is-favorite">♥ 喜欢 / 推荐</span>'] : []),
      ...(game.achievementRate === 1 ? ['<span class="is-perfect">🏆 全成就</span>'] : []),
      ...game.status.map((status) => `<span>${escapeHtml(status)}</span>`),
    ];
    document.getElementById('dialog-tags').innerHTML = tags.join('') || '<span>暂无状态标签</span>';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  /** @author yuecheng */
  function applyTheme(theme, { persist = true } = {}) {
    document.documentElement.dataset.theme = theme;
    document.getElementById('theme-toggle').setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    if (persist) {
      try { localStorage.setItem('game-wall-theme', theme); } catch {}
    }
  }

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.appidImage) return;
    if (image.dataset.stage === 'portrait') {
      image.dataset.stage = 'header';
      image.src = headerUrl(image.dataset.appidImage);
      return;
    }
    image.classList.add('is-missing');
  }, true);

  document.addEventListener('click', (event) => {
    const appTarget = event.target.closest('[data-appid]');
    if (appTarget) {
      openGameDialog(appTarget.dataset.appid);
      return;
    }
    const viewTarget = event.target.closest('[data-view-target]');
    if (viewTarget) {
      showView(viewTarget.dataset.viewTarget);
      return;
    }
    const scrollTarget = event.target.closest('[data-scroll-target]');
    if (scrollTarget) {
      document.getElementById(scrollTarget.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const libraryTarget = event.target.closest('[data-library-filter]');
    if (libraryTarget) {
      setLibraryFilter(libraryTarget.dataset.libraryFilter);
      showView('library');
    }
  });

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => setLibraryFilter(button.dataset.filter));
  });
  document.getElementById('library-search').addEventListener('input', (event) => {
    state.librarySearch = event.target.value;
    state.libraryPages = 1;
    renderLibrary();
  });
  document.getElementById('library-sort').addEventListener('change', (event) => {
    state.librarySort = event.target.value;
    renderLibrary();
  });
  document.getElementById('library-more').addEventListener('click', () => {
    state.libraryPages += 1;
    renderLibrary();
  });
  document.getElementById('timeline-search').addEventListener('input', (event) => {
    state.timelineSearch = event.target.value;
    state.timelineLimit = 60;
    renderTimeline();
  });
  document.getElementById('timeline-more').addEventListener('click', () => {
    state.timelineLimit += 60;
    renderTimeline();
  });
  document.getElementById('dialog-close').addEventListener('click', () => document.getElementById('game-dialog').close());
  document.getElementById('game-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.getElementById('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1), { updateHash: false }));
  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.view === 'library') renderLibrary();
    }, 120);
  });

  let initialTheme;
  try {
    const savedTheme = localStorage.getItem('game-wall-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') initialTheme = savedTheme;
  } catch {}
  if (!initialTheme) {
    initialTheme = typeof window.matchMedia === 'function'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : 'light';
  }
  applyTheme(initialTheme, { persist: false });
  renderSummary();
  renderRecent();
  renderFavorites();
  renderPerfected();
  renderLibrary();
  renderTimeline();
  showView(location.hash.slice(1) || 'showcase', { updateHash: false });
})();
