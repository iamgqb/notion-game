/* 玩家收藏档案：只读取构建阶段导出的静态业务数据。 */
(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const formatNumber = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
  const hours = minutes => formatNumber(minutes / 60);
  const duration = minutes => minutes < 60 ? `${Math.round(minutes)} 分钟` : `${hours(minutes)} 小时`;
  const dayKey = value => value?.slice(0, 10) ?? '';
  const dateLabel = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replaceAll('/', '.') : '时间未记录';
  const shortDate = value => value ? dayKey(value).replaceAll('-', '.') : '时间未记录';
  const percent = value => value === null || value === undefined ? '—' : `${formatNumber(value)}%`;
  const rateLabel = rate => Number.isFinite(rate) && rate >= 0 ? `${Math.round(rate * 100)}%` : '暂无成就数据';
  const state = { view: 'archive', filter: 'all', query: '', sort: 'personal', pageSize: 24, achievementGame: 'all', achievementFilter: 'all', achievementSort: 'rarity', achievementLimit: 24, journeyMonth: 'all', journeyLimit: 20 };
  let library, achievementData, games, gameMap, achievementGames, achievements, history;
  const { sample, selectArchive } = window.CheckpointSelection;
  function renderFeaturedGame(hero) {
    const featured = $('.feature');
    featured.hidden = !hero;
    if (!hero) return;
    const heroAchievements = achievementGames.get(hero.appid)?.achievements ?? [];
    const unlocked = heroAchievements.filter(a => a.unlocked);
    $('#feature-title').textContent = hero.name;
    $('#feature-title').classList.add('is-dynamic');
    $('#feature-subtitle').textContent = hero.favorite ? '这一次，翻到这份喜欢的收藏。' : '这一次，翻到这段游戏旅程。';
    $('#hero-hours').textContent = hours(hero.playTimeMinutes);
    $('#hero-achievements').innerHTML = heroAchievements.length ? `${unlocked.length}<span>/ ${heroAchievements.length}</span>` : Number.isFinite(hero.achievementRate) ? esc(rateLabel(hero.achievementRate)) : '—';
    $('#hero-achievement-label').textContent = heroAchievements.length ? '成就已收集' : '成就完成率';
    $('#hero-open').dataset.openGame = hero.appid;
    const image = $('#hero-image');
    image.dataset.heroAppid = hero.appid;
    image.alt = `${hero.name}游戏主视觉`;
    image.src = `https://cdn.akamai.steamstatic.com/steam/apps/${hero.appid}/library_hero.jpg`;
    $('#hero-art-caption').textContent = hero.name;
    const medal = sample(unlocked, 1, [], a => a.id)[0];
    const medalButton = $('#hero-medal');
    if (medal) {
      medalButton.dataset.achievement = `${hero.appid}:${medal.id}`;
      delete medalButton.dataset.openGame;
      const detail = Number.isFinite(medal.globalPercent) ? `全球 ${percent(medal.globalPercent)} 玩家解锁` : '已解锁成就';
      medalButton.innerHTML = `<span class="medal-icon">${artwork(medal)}</span><span><small>值得纪念的一刻</small><strong>${esc(medal.name)}</strong><span>${icon('trophy')}${detail}</span></span>${icon('arrow-up-right')}`;
    } else {
      delete medalButton.dataset.achievement;
      medalButton.dataset.openGame = hero.appid;
      medalButton.innerHTML = `<span class="medal-icon medal-symbol">${icon(hero.favorite ? 'heart' : 'library-big')}</span><span><small>${hero.favorite ? '我的心头好' : '游玩收藏'}</small><strong>${esc(hero.name)}</strong><span>累计 ${duration(hero.playTimeMinutes)}</span></span>${icon('arrow-up-right')}`;
    }
  }

  function icons() { window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } }); }
  function cover(appid) { return `https://cdn.akamai.steamstatic.com/steam/apps/${Number(appid)}/library_600x900_2x.jpg`; }
  function achievementIcon(a) { return (a.unlocked ? a.icon : a.iconGray) || a.icon || 'assets/achievement-placeholder.svg'; }
  function gameName(appid) { return gameMap.get(Number(appid))?.name ?? history.find(h => h.appid === Number(appid))?.name ?? '未归档游戏'; }
  function artwork(a, className = '') { return `<img class="${className}" data-achievement-icon="true" src="${esc(achievementIcon(a))}" alt="${esc(a.name)}成就图标" loading="lazy">`; }
  function empty(title, description, symbol = 'package-open') { return `<div class="empty-state">${icon(symbol)}<strong>${esc(title)}</strong><p>${esc(description)}</p></div>`; }

  function gameCard(game, index = null) {
    const perfect = game.achievementRate === 1;
    return `<button type="button" class="game-card" data-open-game="${game.appid}" aria-label="查看${esc(game.name)}详情">
      <span class="cover-wrap"><span class="cover-fallback">${esc(game.name)}</span><img src="${cover(game.appid)}" alt="${esc(game.name)}封面" loading="lazy">${perfect ? `<span class="cover-tape">${icon('trophy')} 全成就</span>` : ''}${game.favorite ? `<span class="cover-favorite">${icon('heart')}</span>` : ''}</span>
      <strong class="game-card-title">${esc(game.name)}</strong><span class="game-card-bottom"><span>${duration(game.playTimeMinutes)}</span><b class="${perfect ? '' : 'progress-muted'}">${perfect ? 'COMPLETE' : Number.isFinite(game.achievementRate) && game.achievementRate >= 0 ? rateLabel(game.achievementRate) : '—'}</b></span>${index !== null ? `<span class="shelf-number">COLLECTION / ${String(index + 1).padStart(2, '0')}</span>` : ''}
    </button>`;
  }

  function renderArchive() {
    const selection = selectArchive({ games, achievementGames, achievements });
    const totalMinutes = games.reduce((sum, game) => sum + game.playTimeMinutes, 0);
    const perfectCount = games.filter(g => g.achievementRate === 1).length;
    const favoriteCount = games.filter(g => g.favorite).length;
    $('#archive-stats').innerHTML = [
      ['library-big', games.length, '款游戏', '收进自己的世界'],
      ['clock-3', Math.round(totalMinutes / 60), '小时', '交给热爱的时间'],
      ['trophy', perfectCount, '款全成就', '每一步都走到底'],
      ['heart', favoriteCount, '款心头好', '会反复推荐的作品'],
    ].map(([symbol, value, unit, caption]) => `<div class="stat-item" role="group" aria-label="${formatNumber(value)}${unit}，${esc(caption)}"><span class="stat-icon">${icon(symbol)}</span><div><strong class="stat-number">${formatNumber(value)}<small>${unit}</small></strong><p>${esc(caption)}</p></div></div>`).join('');
    $('#favorite-total').textContent = favoriteCount;
    const dates = games.map(g => g.buyTime).filter(Boolean).sort();
    $('#start-year').textContent = dates[0]?.slice(0, 4) ?? '2014';
    renderFeaturedGame(selection.hero);
    $('#favorites-shelf').innerHTML = selection.picks.map(gameCard).join('') || empty('心头好，留给真正喜欢的作品', '在游戏库标记喜欢后，它们会出现在这里。', 'heart');
    const rarePicks = selection.rare;
    $('#rare-list').innerHTML = rarePicks.map(a => `<button type="button" class="rare-item" data-achievement="${esc(a.key)}">${artwork(a)}<span class="rare-item-copy"><strong>${esc(a.name)}</strong><small>${esc(gameName(a.appid))}</small></span><span class="rarity"><span>${icon('gem')}${percent(a.globalPercent)}</span><small>全球玩家解锁</small></span></button>`).join('') || empty('还没有收藏到稀有勋章', '全球解锁比例不高于 5% 的已解锁成就会出现在这里。', 'gem');
    const recent = selection.memories;
    $('#recent-list').innerHTML = recent.map(g => `<button type="button" class="recent-item" data-open-game="${g.appid}"><img src="${cover(g.appid)}" alt="${esc(g.name)}封面" loading="lazy"><span><strong>${esc(g.name)}</strong><small>${shortDate(g.lastPlayed)} · 记录增量</small></span><span class="recent-duration">+ ${duration(g.lastSessionMinutes)}<small>累计 ${duration(g.playTimeMinutes)}</small></span></button>`).join('') || empty('冒险还没有留下足迹', '有游玩记录后，就能从这里翻看回忆。', 'footprints');
    $('#completion-grid').innerHTML = selection.completed.map(g => {
      const ag = achievementGames.get(g.appid);
      const progress = ag ? `${ag.achievements.filter(a => a.unlocked).length} / ${ag.achievements.length} 成就` : '100% 成就完成';
      return `<button type="button" class="completion-item" data-open-game="${g.appid}"><img src="${cover(g.appid)}" alt="${esc(g.name)}封面" loading="lazy"><span><strong>${esc(g.name)}</strong><small>${progress} · ${duration(g.playTimeMinutes)}</small></span>${icon('award')}</button>`;
    }).join('') || empty('下一段圆满旅程，等待开启', '完成率达到 100% 的游戏会收进这里。', 'trophy');
  }

  function filteredGames() {
    const query = state.query.trim().toLocaleLowerCase('zh-CN');
    return games.filter(g => (!query || g.name.toLocaleLowerCase('zh-CN').includes(query)) && (state.filter !== 'favorite' || g.favorite) && (state.filter !== 'perfected' || g.achievementRate === 1) && (state.filter !== 'unplayed' || g.playTimeMinutes === 0)).sort((a, b) => {
      if (state.sort === 'hours') return b.playTimeMinutes - a.playTimeMinutes;
      if (state.sort === 'recent') return (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '') || b.playTimeMinutes - a.playTimeMinutes;
      if (state.sort === 'achievement') return (b.achievementRate ?? -1) - (a.achievementRate ?? -1) || b.playTimeMinutes - a.playTimeMinutes;
      if (state.sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      const rank = g => g.favorite ? 0 : g.achievementRate === 1 ? 1 : 2;
      return rank(a) - rank(b) || b.playTimeMinutes - a.playTimeMinutes;
    });
  }

  function renderCollection() {
    const matches = filteredGames();
    const visible = matches.slice(0, state.pageSize);
    const counts = { all: games.length, favorite: games.filter(g => g.favorite).length, perfected: games.filter(g => g.achievementRate === 1).length, unplayed: games.filter(g => g.playTimeMinutes === 0).length };
    $$('#collection-filters>button').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)); $('span', button).textContent = counts[button.dataset.filter]; });
    $('#collection-result').textContent = `${matches.length} 款收藏 · 当前展示 ${visible.length} 款`;
    $('#library-grid').innerHTML = visible.length ? visible.map(g => gameCard(g)).join('') : empty('这页收藏暂时空着', '换个游戏名称，或试试其他筛选条件。', 'search');
    $('#library-more').hidden = visible.length >= matches.length;
    icons();
  }

  function achievementCard(a) {
    const rare = a.globalPercent !== null && a.globalPercent <= 5;
    return `<button type="button" class="achievement-card ${rare ? 'is-rare' : ''}" data-achievement="${esc(a.key)}"><span class="achievement-card-top">${artwork(a, a.unlocked ? '' : 'locked-image')}${rare ? `<span class="rarity-pill">${icon('gem')}${percent(a.globalPercent)} 解锁</span>` : `<span class="rarity-pill">${percent(a.globalPercent)}</span>`}</span><strong>${esc(a.name)}</strong><span class="achievement-game-name">${esc(gameName(a.appid))}</span><p class="achievement-description">${esc(a.description || (a.hidden && !a.unlocked ? '隐藏成就：等待你亲自发现。' : '这枚成就暂未提供描述。'))}</p><span class="achievement-card-bottom"><span>${icon(a.unlocked ? 'circle-check' : 'lock-keyhole')}${a.unlocked ? '已解锁' : a.unlocked === false ? '未解锁' : '状态未知'}</span><time>${a.unlockedAt ? dateLabel(a.unlockedAt) : '时间未记录'}</time></span></button>`;
  }

  function filteredAchievements() {
    return achievements.filter(a => (state.achievementGame === 'all' || a.appid === Number(state.achievementGame)) && (state.achievementFilter !== 'rare' || (a.globalPercent !== null && a.globalPercent <= 5)) && (state.achievementFilter !== 'unlocked' || a.unlocked) && (state.achievementFilter !== 'locked' || a.unlocked === false)).sort((a, b) => {
      if (state.achievementSort === 'recent') return (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? '');
      if (state.achievementSort === 'game') return gameName(a.appid).localeCompare(gameName(b.appid), 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN');
      return (a.globalPercent ?? 101) - (b.globalPercent ?? 101) || a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  function renderAchievementHeader() {
    const unlocked = achievements.filter(a => a.unlocked);
    const rare = unlocked.filter(a => a.globalPercent !== null && a.globalPercent <= 5);
    $('#achievement-overview').innerHTML = [
      ['medal', unlocked.length, '枚已收集成就'], ['gem', rare.length, '枚稀有成就 · 全球解锁 ≤ 5%'], ['trophy', achievementData.games.filter(g => g.achievements.every(a => a.unlocked)).length, '款全成就游戏 · 本次读取'],
    ].map(([symbol, count, caption]) => `<div>${icon(symbol)}<span><b>${formatNumber(count)}</b><small>${esc(caption)}</small></span></div>`).join('');
    $('#achievement-games').innerHTML = `<button class="game-selector" type="button" data-achievement-game="all" aria-pressed="true">${icon('layout-grid')}<span>全部成就<small>${achievementData.games.length} GAMES / ${achievements.length} BADGES</small></span></button>` + achievementData.games.map(g => `<button class="game-selector" type="button" data-achievement-game="${g.appid}" aria-pressed="false"><img src="${cover(g.appid)}" alt="" loading="lazy"><span>${esc(gameName(g.appid))}<small>${g.achievements.filter(a => a.unlocked).length} / ${g.achievements.length}</small></span></button>`).join('');
  }

  function renderAchievements() {
    const matches = filteredAchievements();
    const visible = matches.slice(0, state.achievementLimit);
    $$('#achievement-games>button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.achievementGame === String(state.achievementGame))));
    $$('#achievement-filters>button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.achievementFilter === state.achievementFilter)));
    $('#achievement-coverage').textContent = `已收录 ${achievementData.games.length} 款游戏的成就明细`;
    $('#achievement-result').textContent = `${matches.length} 枚成就 · 当前展示 ${visible.length} 枚`;
    $('#achievement-grid').innerHTML = visible.length ? visible.map(achievementCard).join('') : empty(state.achievementFilter === 'locked' ? '当前没有未解锁的成就' : '暂时没有符合条件的成就', state.achievementFilter === 'locked' ? '换个游戏或筛选条件，继续看看其他成就。' : '试试选择其他游戏或切换筛选。', 'trophy');
    $('#achievement-more').hidden = visible.length >= matches.length;
    icons();
  }

  function renderJourneyHeader() {
    const days = new Set(history.map(h => dayKey(h.date)));
    const minutes = history.reduce((total, h) => total + h.minutes, 0);
    $('#journey-overview').innerHTML = `<div><span>历史里收集到的时间</span><strong>${hours(minutes)}</strong><small>小时</small></div><div><span>留下游玩记录的日子</span><strong>${days.size}</strong><small>天</small></div><div><span>记录跨越的游戏</span><strong>${new Set(history.map(h => h.appid)).size}</strong><small>款</small></div>`;
    const months = [...new Set(history.map(h => h.date.slice(0, 7)))].sort().reverse();
    $('#journey-month').innerHTML = '<option value="all">全部历史</option>' + months.map(month => `<option value="${month}">${month.replace('-', ' 年 ')} 月</option>`).join('');
  }

  function renderActivity() {
    if (!history.length) {
      $('#activity-grid').innerHTML = empty('冒险日历还没有记录', '游玩历史更新后，会在这里留下足迹。', 'calendar-days');
      return;
    }
    const records = state.journeyMonth === 'all' ? history : history.filter(h => h.date.startsWith(state.journeyMonth));
    const minutesByDate = new Map();
    for (const record of records) minutesByDate.set(dayKey(record.date), (minutesByDate.get(dayKey(record.date)) ?? 0) + record.minutes);
    const activityGrid = $('#activity-grid');
    activityGrid.classList.toggle('is-month', state.journeyMonth !== 'all');
    if (state.journeyMonth !== 'all') {
      const first = new Date(`${state.journeyMonth}-01T12:00:00Z`);
      const numberOfDays = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const offset = (first.getUTCDay() + 6) % 7;
      let monthMarkup = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => `<span class="activity-weekday">${day}</span>`).join('');
      monthMarkup += '<span class="calendar-spacer" aria-hidden="true"></span>'.repeat(offset);
      for (let day = 1; day <= numberOfDays; day++) {
        const dateString = `${state.journeyMonth}-${String(day).padStart(2, '0')}`;
        const minutes = minutesByDate.get(dateString) ?? 0;
        const level = minutes >= 180 ? 4 : minutes >= 90 ? 3 : minutes >= 30 ? 2 : minutes > 0 ? 1 : 0;
        monthMarkup += `<span class="activity-cell activity-month-day" data-level="${level}" title="${dateString} · ${duration(minutes)}" aria-label="${dateString}，${duration(minutes)}" role="img">${day}</span>`;
      }
      activityGrid.innerHTML = monthMarkup;
      $('#activity-title').textContent = `${state.journeyMonth.replace('-', ' 年 ')} 月的冒险`;
      return;
    }
    const endDate = state.journeyMonth === 'all' ? new Date(`${dayKey(history[0]?.date)}T12:00:00Z`) : new Date(`${state.journeyMonth}-01T12:00:00Z`);
    if (state.journeyMonth !== 'all') endDate.setUTCMonth(endDate.getUTCMonth() + 1, 0);
    const end = new Date(endDate); end.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()) % 7);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 97);
    let markup = '';
    for (let row = 0; row < 7; row++) {
      markup += `<span class="activity-weekday">${['周一', '', '周三', '', '周五', '', '周日'][row]}</span>`;
      for (let week = 0; week < 14; week++) {
        const date = new Date(start); date.setUTCDate(date.getUTCDate() + week * 7 + row);
        const dateString = date.toISOString().slice(0, 10);
        const minutes = minutesByDate.get(dateString) ?? 0;
        const level = minutes >= 180 ? 4 : minutes >= 90 ? 3 : minutes >= 30 ? 2 : minutes > 0 ? 1 : 0;
        markup += `<span class="activity-cell" data-level="${level}" title="${dateString} · ${duration(minutes)}" aria-label="${dateString}，${duration(minutes)}" role="img"></span>`;
      }
    }
    $('#activity-grid').innerHTML = markup;
    $('#activity-title').textContent = state.journeyMonth === 'all' ? '留在日历里的冒险 · 快照末尾 14 周' : `${state.journeyMonth.replace('-', ' 年 ')} 月的冒险`;
  }

  function renderJourney() {
    const records = state.journeyMonth === 'all' ? history : history.filter(h => h.date.startsWith(state.journeyMonth));
    const visible = records.slice(0, state.journeyLimit);
    const groups = new Map();
    for (const record of visible) { const key = dayKey(record.date); const list = groups.get(key) ?? []; list.push(record); groups.set(key, list); }
    $('#journey-list').innerHTML = [...groups].map(([date, rows]) => `<section class="journey-day"><time class="journey-date" datetime="${date}"><b>${date.slice(8)}</b><span>${date.slice(0, 7).replace('-', ' / ')}</span></time><div class="journey-day-records">${rows.map(record => `<button type="button" class="journey-row" data-open-game="${record.appid}"><img src="${cover(record.appid)}" alt="${esc(record.name)}封面" loading="lazy"><span><strong>${esc(record.name)}</strong><small>记录到新的游玩增量</small></span><span class="journey-minutes">+ ${duration(record.minutes)}<small>游戏时间</small></span></button>`).join('')}</div></section>`).join('') || empty('这一页还没有留下足迹', '换一个月份，看看你走过的世界。', 'footprints');
    $('#journey-more').hidden = visible.length >= records.length;
    renderActivity();
    icons();
  }

  function openGame(appid) {
    const game = gameMap.get(Number(appid));
    if (!game) { toast('这款游戏只有历史记录，尚未收录到游戏库。'); return; }
    const ag = achievementGames.get(game.appid);
    const records = history.filter(h => h.appid === game.appid).slice(0, 5);
    const validRate = Number.isFinite(game.achievementRate) && game.achievementRate >= 0;
    const rate = validRate ? Math.round(game.achievementRate * 100) : 0;
    let badges = (game.favorite ? `<span class="tag tag-red">${icon('heart')} 心头好</span>` : '') + (game.achievementRate === 1 ? `<span class="tag tag-gold">${icon('trophy')} 全成就</span>` : '') + game.status.filter(s => s !== '全成就').map(s => `<span class="tag">${esc(s)}</span>`).join('');
    let details;
    if (ag) {
      const selected = [...ag.achievements].sort((a, b) => (a.globalPercent ?? 101) - (b.globalPercent ?? 101)).slice(0, 6);
      details = `<div class="dialog-section-title"><h3>成就收藏</h3><span>${ag.achievements.filter(a => a.unlocked).length} / ${ag.achievements.length} 已解锁 · 全球解锁比例从低到高</span></div><div class="progress-bar"><span style="width:${rate}%"></span></div><div class="dialog-achievement-list">${selected.map(a => `<button class="dialog-achievement-row" type="button" data-achievement="${esc(`${game.appid}:${a.id}`)}">${artwork(a)}<span><strong>${esc(a.name)}</strong><small>${esc(a.description || '隐藏成就')}</small></span><span class="mono">${percent(a.globalPercent)}</span></button>`).join('')}</div>`;
    } else {
      details = `<div class="dialog-section-title"><h3>成就进度</h3><span>${rateLabel(game.achievementRate)}</span></div><div class="progress-bar"><span style="width:${rate}%"></span></div><div class="dialog-notice">${icon('info')}<p>这款游戏暂无可展示的成就明细。${validRate ? '当前完成率来自游戏档案。' : '游戏可能没有成就，或成就数据暂不可用。'}</p></div>`;
    }
    const recordMarkup = !ag && records.length ? `<div class="dialog-section-title" style="margin-top:25px"><h3>最近的游玩记录</h3><span>同步发现的时长增量</span></div><div class="dialog-records">${records.map(r => `<div class="dialog-record"><span>${shortDate(r.date)}</span><span>+ ${duration(r.minutes)}</span></div>`).join('')}</div>` : '';
    $('#game-dialog-content').innerHTML = `<div class="dialog-head"><img class="dialog-cover" src="${cover(game.appid)}" alt="${esc(game.name)}封面"><div class="dialog-game-info"><p class="eyebrow">THE COLLECTION / STEAM ${game.appid}</p><h2 id="dialog-title">${esc(game.name)}</h2><div class="dialog-badges">${badges || '<span class="tag">我的收藏</span>'}</div><div class="dialog-stat-row"><span><b>${hours(game.playTimeMinutes)}</b>小时累计游玩</span><span><b>${validRate ? `${rate}%` : '—'}</b>成就完成率</span><span><b>${game.historyCount}</b>条历史记录</span></div></div></div><div class="dialog-content-body">${details}${recordMarkup}<div class="dialog-action-row"><button class="primary-button" type="button" data-view-game-achievements="${ag ? game.appid : 'all'}">${ag ? '查看这款游戏的全部成就' : '探索成就陈列柜'} ${icon('arrow-up-right')}</button><a class="text-link" href="https://store.steampowered.com/app/${game.appid}/" target="_blank" rel="noopener noreferrer">Steam 商店 ${icon('external-link')}</a></div></div>`;
    icons();
    const dialog = $('#game-dialog');
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }

  function openAchievement(key) {
    const a = achievements.find(a => a.key === key);
    if (!a) return;
    const unlockLabel = a.unlocked === true ? '已收入收藏' : a.unlocked === false ? '尚未解锁' : '状态待同步';
    $('#achievement-dialog-content').innerHTML = `<div class="achievement-detail-top"><p class="eyebrow">A MOMENT WORTH KEEPING</p><span class="achievement-emblem">${artwork(a)}</span><h2 id="achievement-dialog-title">${esc(a.name)}</h2><span class="achievement-detail-game">${esc(gameName(a.appid))}</span><p class="achievement-detail-description">${esc(a.description || (a.hidden ? '这是一枚隐藏成就。' : '这枚成就暂未提供描述。'))}</p><span class="tag ${a.unlocked ? 'tag-gold' : ''}">${icon(a.unlocked ? 'circle-check' : 'lock-keyhole')}${unlockLabel}${a.hidden ? ' · 隐藏成就' : ''}</span></div><div class="achievement-detail-stats"><span>全球玩家解锁比例<strong>${percent(a.globalPercent)}</strong></span><span>我的解锁日期<strong>${a.unlockedAt ? dateLabel(a.unlockedAt) : '时间未记录'}</strong></span></div><div class="achievement-detail-bottom"><button type="button" class="text-link" data-view-game-achievements="${a.appid}">查看这款游戏的全部成就 ${icon('arrow-right')}</button></div>`;
    icons();
    const dialog = $('#achievement-dialog');
    if (!dialog.open) dialog.showModal();
  }

  function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 3200); }

  function route() {
    if (!games) return;
    const [target, query = ''] = location.hash.slice(1).split('?');
    const normalizedTarget = ({showcase:'archive',library:'collection',timeline:'journey'})[target] || target;
    const view = ['archive', 'collection', 'achievements', 'journey'].includes(normalizedTarget) ? normalizedTarget : 'archive';
    const params = new URLSearchParams(query);
    state.view = view;
    $$('.page').forEach(page => { page.hidden = page.id !== `${view}-view`; });
    $$('[data-nav]').forEach(link => { if (link.dataset.nav === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    if (view === 'collection') {
      if (params.has('filter') && ['all', 'favorite', 'perfected', 'unplayed'].includes(params.get('filter'))) state.filter = params.get('filter');
      renderCollection();
    }
    if (view === 'achievements') {
      if (params.has('game')) { const id = params.get('game'); state.achievementGame = id === 'all' || !achievementGames.has(Number(id)) ? 'all' : id; state.achievementLimit = 24; }
      renderAchievements();
    }
    if (view === 'journey') renderJourney();
    $$('dialog[open]').forEach(dialog => dialog.close());
    document.title = `${({ archive: '我的游戏档案', collection: '游戏收藏', achievements: '成就陈列柜', journey: '冒险足迹' })[view]} — 存档点 CHECKPOINT`;
    window.scrollTo({ top: 0, behavior: 'instant' });
    icons();
  }

  function wireInteractions() {
    $('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#main').focus(); });
    window.addEventListener('hashchange', route);
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.classList.contains('dialog-close')) { button.closest('dialog').close(); return; }
      if (button.dataset.openGame) { openGame(button.dataset.openGame); return; }
      if (button.dataset.achievement) { openAchievement(button.dataset.achievement); return; }
      if (button.dataset.viewGameAchievements) {
        const next = `#achievements?game=${button.dataset.viewGameAchievements}`;
        if (location.hash === next) route(); else location.hash = next;
        return;
      }
      if (button.dataset.filter) {
        state.filter = button.dataset.filter; state.pageSize = 24;
        historyReplace(`#collection?filter=${state.filter}`);
        renderCollection(); return;
      }
      if (button.dataset.achievementGame) {
        state.achievementGame = button.dataset.achievementGame; state.achievementLimit = 24;
        historyReplace(`#achievements?game=${state.achievementGame}`);
        renderAchievements(); return;
      }
      if (button.dataset.achievementFilter) { state.achievementFilter = button.dataset.achievementFilter; state.achievementLimit = 24; renderAchievements(); return; }
      if (button.id === 'library-more') { state.pageSize += 24; renderCollection(); }
      if (button.id === 'achievement-more') { state.achievementLimit += 24; renderAchievements(); }
      if (button.id === 'journey-more') { state.journeyLimit += 20; renderJourney(); }
    });
    $('#collection-search').addEventListener('input', event => { state.query = event.target.value; state.pageSize = 24; renderCollection(); });
    $('#collection-sort').addEventListener('change', event => { state.sort = event.target.value; state.pageSize = 24; renderCollection(); });
    $('#achievement-sort').addEventListener('change', event => { state.achievementSort = event.target.value; state.achievementLimit = 24; renderAchievements(); });
    $('#journey-month').addEventListener('change', event => { state.journeyMonth = event.target.value; state.journeyLimit = 20; renderJourney(); });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && state.view === 'collection' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !$('dialog[open]')) { event.preventDefault(); $('#collection-search').focus(); }
    });
    $$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    }));
    document.addEventListener('error', event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (img.dataset.achievementIcon && !img.dataset.fallback) {
        img.dataset.fallback = 'true';
        img.src = 'assets/achievement-placeholder.svg';
        return;
      }
      if (img.dataset.heroAppid && !img.dataset.fallback) {
        img.dataset.fallback = 'true';
        img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${img.dataset.heroAppid}/header.jpg`;
        return;
      }
      if (img.src.includes('library_600x900') && !img.dataset.fallback) {
        img.dataset.fallback = 'true';
        const appid = img.src.match(/apps\/(\d+)/)?.[1];
        if (appid) { img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`; return; }
      }
      img.classList.add('is-missing');
    }, true);
  }
  function historyReplace(hash) { window.history.replaceState(null, '', hash); }

  async function init() {
    icons();
    try {
      library = window.NOTION_GAME_DATA;
      if (!library || !Array.isArray(library.games) || !Array.isArray(library.history)) throw new Error('Site data unavailable');
      achievementData = library.achievements ?? { updatedAt: null, games: [] };
      const unique = new Map();
      for (const game of library.games) {
        const previous = unique.get(game.appid);
        if (!previous || game.playTimeMinutes > previous.playTimeMinutes) unique.set(game.appid, { ...game });
      }
      games = [...unique.values()]; gameMap = new Map(games.map(g => [g.appid, g]));
      achievementGames = new Map(achievementData.games.map(g => [g.appid, g]));
      achievements = achievementData.games.flatMap(g => g.achievements.map(a => ({ ...a, appid: g.appid, key: `${g.appid}:${a.id}` })));
      for (const g of games) if (g.achievementRate < 0) g.achievementRate = null;
      history = [...library.history].sort((a, b) => b.date.localeCompare(a.date) || b.minutes - a.minutes);
      renderArchive(); renderAchievementHeader(); renderJourneyHeader();
      $('#data-dates').textContent = `游戏档案 ${dateLabel(library.meta.generatedAt)} · ${achievementData.updatedAt ? `成就更新 ${dateLabel(achievementData.updatedAt)}` : '成就明细暂未同步'}`;
      wireInteractions();
      $('#loading').hidden = true;
      route();
    } catch (error) {
      $('#loading').innerHTML = '<p class="error-state">游戏档案暂时无法打开，请稍后刷新重试。</p>';
      console.error('Archive initialization failed:', error.name);
    }
  }
  init();
})();
