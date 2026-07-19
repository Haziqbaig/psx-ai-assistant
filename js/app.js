/**
 * app.js — StockSage AI: Complete application with routing, views, and state.
 * PSX (Pakistan Stock Exchange) smart dashboard with Bloomberg-terminal aesthetic.
 * Navy/Teal/Amber color scheme with glass-morphism cards.
 */

const App = (() => {
  'use strict';

  // ---- Constants ----
  const DEFAULT_WATCHLIST = ['ENGRO.KA','HUBC.KA','LUCK.KA','MEBL.KA','SYS.KA','FFC.KA','OGDC.KA','MCB.KA'];
  const IND_DAYS = 260;  // ~1 year of trading days
  const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes
  const CLOCK_INTERVAL = 30 * 1000;       // 30 seconds

  // ---- State ----
  const state = {
    route: 'dashboard',
    watchlist: JSON.parse(localStorage.getItem('ss_watchlist') || 'null') || DEFAULT_WATCHLIST.slice(),
    theme: localStorage.getItem('ss_theme') || 'dark',
    currency: 'pkr',
    cachedData: null,
    lastUpdate: null,
    chart: null,
    chartRange: '3mo'
  };

  // Render sequence token for async view safety
  let renderSeq = 0;
  const newSeq = () => ++renderSeq;
  const isCurrent = (tok) => tok === renderSeq;

  // ---- Shortcuts ----
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const main = () => document.getElementById('mainContent');

  // ---- Persistence ----
  function saveWatchlist() { localStorage.setItem('ss_watchlist', JSON.stringify(state.watchlist)); }
  function saveTheme() { localStorage.setItem('ss_theme', state.theme); }

  // ---- Helper utilities ----
  function cssId(sym) { return (sym || '').replace(/[^a-zA-Z0-9]/g, '_'); }
  function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

  function dimNote(msg) {
    return `<div class="text-dim text-sm py-8 text-center">${msg}</div>`;
  }

  function fmtVol(v) {
    if (v == null || isNaN(v) || v === 0) return '—';
    if (v >= 1e9) return (v/1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v/1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v/1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function getRatingClass(rating) {
    const map = {
      'Strong Buy': 'rating-strong-buy',
      'Buy': 'rating-buy',
      'Hold': 'rating-hold',
      'Reduce': 'rating-reduce',
      'Sell': 'rating-sell',
      'Strong Sell': 'rating-strong-sell'
    };
    return map[rating] || 'text-dim';
  }

  // ---- Routing ----

  /** Map UI timeframe key → { range, interval } for Yahoo Finance */
  function chartTimeframe(key) {
    const map = {
      '1d':  { range: '1d',  interval: '5m' },
      '5d':  { range: '5d',  interval: '30m' },
      '1mo': { range: '1mo', interval: '1d' },
      '3mo': { range: '3mo', interval: '1d' },
      '6mo': { range: '6mo', interval: '1d' },
      '1y':  { range: '1y',  interval: '1d' },
      '5y':  { range: '5y',  interval: '1wk' },
    };
    return map[key] || map['3mo'];
  }

  function navigate(route, data) {
    if (!route) return;
    newSeq();
    state.route = route;
    state.routeData = data || null;

    // Update hash (quietly — don't trigger re-render)
    const oldHandler = window.onhashchange;
    window.onhashchange = null;
    window.location.hash = route + (data ? '/' + data : '');
    setTimeout(() => { window.onhashchange = oldHandler; }, 10);

    // Update sidebar nav states
    document.querySelectorAll('[data-route]').forEach(el => {
      const r = el.getAttribute('data-route');
      el.classList.toggle('active', r === route);
    });
    // Update mobile nav too
    document.querySelectorAll('.mobile-nav[data-route]').forEach(el => {
      const r = el.getAttribute('data-route');
      el.classList.toggle('active', r === route);
    });

    // Render the view
    switch (route) {
      case 'dashboard': renderDashboard(); break;
      case 'watchlist': renderWatchlist(); break;
      case 'sectors': renderSectors(); break;
      case 'market': renderMarketBreadth(); break;
      case 'index': renderIndexView(); break;
      case 'stock': renderStockDetail(data); break;
      case 'search': renderSearchView(); break;
      default: navigate('dashboard'); break;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Handle browser back/forward
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    const [route, ...rest] = hash.split('/');
    if (route && route !== state.route) {
      navigate(route, rest.join('/') || null);
    }
  });

  // ---- Theme Toggle ----
  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveTheme();
    const label = document.getElementById('themeLabel');
    const icon = document.querySelector('#themeLabel')?.previousElementSibling;
    if (label) label.textContent = state.theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    if (icon) icon.className = state.theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  }

  function applyTheme() {
    document.body.classList.toggle('light', state.theme === 'light');
    // Update theme label and icon
    const label = document.getElementById('themeLabel');
    const iconEl = document.querySelector('button[onclick="App.toggleTheme()"] i');
    if (label) label.textContent = state.theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    if (iconEl) iconEl.className = state.theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  }

  // ---- Trading Clock ----
  function startTradingClock() {
    UI.updateTradingClock();
    setInterval(() => UI.updateTradingClock(), CLOCK_INTERVAL);
  }

  // ---- Auto-refresh ----
  let refreshTimer = null;
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      // Silently re-render current view
      if (state.route === 'dashboard') renderDashboard();
      else if (state.route === 'watchlist') renderWatchlist();
      else if (state.route === 'sectors') renderSectors();
      else if (state.route === 'market') renderMarketBreadth();
      else if (state.route === 'index') renderIndexView();
    }, REFRESH_INTERVAL);
  }

  // ════════════════════════════════════════════
  // VIEW: Dashboard (progressive — updates as v8 batches resolve)
  // ════════════════════════════════════════════
  async function renderDashboard() {
    const tok = newSeq();
    const t0 = performance.now();
    main().innerHTML = dashboardSkeleton();

    try {
      const allSyms = KSE100_STOCKS.map(s => s.symbol);

      // Kick off index fetch immediately
      const indexPromise = API.kse100Index('3mo').catch(() => null);

      // Progressive callback: fires after each concurrency worker (~8 symbols) resolves.
      // Only updates the data sections (gainers/losers/active/stats/sentiment) on the
      // already-rendered shell — avoids full re-render flicker.
      let shellRendered = false;
      let latestIndexData = null;

      function onSnapshotBatch(partialSnaps) {
        if (!isCurrent(tok)) return;
        if (!shellRendered) return; // wait for shell
        renderDashboardData(partialSnaps, latestIndexData, tok);
      }

      const snapsPromise = API.allSnapshots(allSyms, onSnapshotBatch);

      // Wait for index data first to render the shell
      const indexData = await indexPromise;
      if (!isCurrent(tok)) return;
      latestIndexData = indexData;

      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      renderDashboardShell(indexData, tok, elapsed);
      shellRendered = true;

      // Now wait for all snapshots — progressive updates happen via onSnapshotBatch
      const snaps = await snapsPromise;
      if (!isCurrent(tok)) return;

      // Final render with complete data
      renderDashboardData(snaps, indexData, tok);
    } catch (e) {
      if (!isCurrent(tok)) return;
      main().innerHTML = UI.errorCard('Failed to load market data. Yahoo Finance may be rate-limiting — try again shortly.', "App.navigate('dashboard')");
    }
  }

  function dashboardSkeleton() {
    return `<div class="space-y-4 fade-in">
      <div class="text-center text-xs text-dim">Fetching live PSX data…</div>
      <div class="stats-grid">${Array(4).fill(UI.skeletonCard(2)).join('')}</div>
      <div class="grid gap-4 lg:grid-cols-3">${Array(3).fill(UI.skeletonCard(6)).join('')}</div>
    </div>`;
  }

  function renderDashboardShell(indexData, tok, elapsed) {
    if (!isCurrent(tok)) return;
    const m = indexData?.meta || {};
    let idxPrice = m.price;
    let idxPrev = m.previousClose;
    if ((!idxPrice || idxPrice === 0) && indexData?.prices?.length) {
      idxPrice = indexData.prices[indexData.prices.length - 1][1];
    }
    if ((!idxPrev || idxPrev === 0) && indexData?.prices?.length >= 2) {
      idxPrev = indexData.prices[indexData.prices.length - 2][1];
    }
    const idxChange = (idxPrice && idxPrev) ? ((idxPrice - idxPrev) / idxPrev) * 100 : null;
    const idxCls = idxChange == null ? 'text-dim' : idxChange >= 0 ? 'text-emerald-400' : 'text-rose-400';

    main().innerHTML = `<div class="fade-in space-y-5">
      <!-- Stat Cards -->
      <div class="stats-grid">
        <div class="glass p-5 glass-hover">
          <div class="text-dim text-xs uppercase tracking-wider mb-1">KSE-100 Index</div>
          <div class="text-2xl font-bold">${idxPrice ? idxPrice.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}</div>
          <div class="text-sm mt-1 ${idxCls}">${idxChange != null ? (idxChange>=0?'+':'')+idxChange.toFixed(2)+'%' : '—'}</div>
        </div>
        <div class="glass p-5 glass-hover" onclick="App.navigate('index')">
          <div class="text-dim text-xs uppercase tracking-wider mb-1">Market Cap</div>
          <div class="text-2xl font-bold" id="statMarketCap">—</div>
          <div class="text-dim text-xs mt-1">Aggregate KSE-100</div>
        </div>
        <div class="glass p-5 glass-hover">
          <div class="text-dim text-xs uppercase tracking-wider mb-1">Traded Volume</div>
          <div class="text-2xl font-bold" id="statVolume">—</div>
          <div class="text-dim text-xs mt-1">Today's activity</div>
        </div>
        <div class="glass p-5 glass-hover" onclick="App.navigate('market')">
          <div class="text-dim text-xs uppercase tracking-wider mb-1">Advance / Decline</div>
          <div class="text-2xl font-bold" id="statAD">— / —</div>
          <div class="text-dim text-xs mt-1">Market breadth</div>
        </div>
      </div>

      <!-- Sentiment Gauge + Top Lists -->
      <div class="grid gap-4 lg:grid-cols-3">
        <!-- Sentiment -->
        <div class="glass p-5 flex flex-col justify-center items-center text-center">
          <div class="text-dim text-xs uppercase tracking-wider mb-2">Market Sentiment</div>
          <div id="sentimentEmoji" class="text-4xl mb-2">—</div>
          <div id="sentimentLabel" class="text-xl font-bold mb-1">—</div>
          <div id="sentimentBar" class="w-full max-w-xs mt-2">${UI.skeleton('h-2','w-full')}</div>
        </div>
        <!-- Top Gainers -->
        <div class="glass p-5">
          <div class="font-semibold text-sm mb-3 flex items-center gap-2"><i class="fas fa-arrow-up text-emerald-400"></i> Top Gainers</div>
          <div id="gainersList">${Array(3).fill(UI.skeleton('h-10','w-full')).join('<div class="my-1"></div>')}</div>
        </div>
        <!-- Top Losers -->
        <div class="glass p-5">
          <div class="font-semibold text-sm mb-3 flex items-center gap-2"><i class="fas fa-arrow-down text-rose-400"></i> Top Losers</div>
          <div id="losersList">${Array(3).fill(UI.skeleton('h-10','w-full')).join('<div class="my-1"></div>')}</div>
        </div>
      </div>

      <!-- Most Active -->
      <div class="glass p-5">
        <div class="font-semibold text-sm mb-3 flex items-center gap-2"><i class="fas fa-fire text-amber-400"></i> Most Active</div>
        <div id="activeList" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">${Array(5).fill(UI.skeleton('h-10','w-full')).join('')}</div>
      </div>

      <div class="text-center text-[10px] text-dim">Loaded in ${elapsed || '—'}s · ${new Date().toLocaleTimeString()}</div>
    </div>`;
  }

  function renderDashboardData(snaps, indexData, tok) {
    if (!isCurrent(tok)) return;
    const cur = state.currency;
    const rows = Object.values(snaps).filter(s => s.changePct != null && s.price != null);

    // Attach metadata
    rows.forEach(r => {
      const m = STOCK_MAP[r.symbol];
      if (m) { r.name = m.name; r.sector = m.sector; r.marketCap = m.marketCap; r.peRatio = m.peRatio; }
    });

    // Sort
    const gainers = [...rows].filter(r => r.changePct > 0).sort((a,b) => b.changePct - a.changePct).slice(0, 5);
    const losers = [...rows].filter(r => r.changePct < 0).sort((a,b) => a.changePct - b.changePct).slice(0, 5);
    const active = [...rows].filter(r => r.volume).sort((a,b) => (b.volume||0) - (a.volume||0)).slice(0, 5);

    // Quick stock row component
    const stockRow = (s, compact) => `
      <div class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition" onclick="App.navigate('stock','${s.symbol}')">
        <div class="text-xs font-semibold text-teal-300 w-10 shrink-0">${(s.symbol||'').replace('.KA','')}</div>
        <div class="flex-1 min-w-0 text-xs truncate text-dim">${s.name||s.symbol}</div>
        <div class="text-xs text-right shrink-0">${UI.money(s.price, cur, {compact:true})}</div>
        <div class="text-xs w-16 text-right shrink-0">${UI.pct(s.changePct)}</div>
        ${compact ? '' : `<div class="text-xs shrink-0">${UI.ratingBadge(getQuickRating(s), true)}</div>`}
      </div>`;

    setHTML('gainersList', gainers.length ? gainers.map(s => stockRow(s)).join('') : dimNote('No gainers data'));
    setHTML('losersList', losers.length ? losers.map(s => stockRow(s)).join('') : dimNote('No losers data'));
    setHTML('activeList', active.length ? active.map(s => stockRow(s, true)).join('') : dimNote('No activity data'));

    // Quick rating from change % only (for dashboard lists)
    function getQuickRating(s) {
      const chg = s.changePct || 0;
      if (chg > 3) return 'Strong Buy';
      if (chg > 1) return 'Buy';
      if (chg > -1) return 'Hold';
      return 'Sell';
    }

    // Market breadth
    const priceMap = {};
    rows.forEach(r => { priceMap[r.symbol] = { price: r.price, changePct: r.changePct, volume: r.volume }; });
    const breadth = Sectors.marketBreadth(priceMap);

    // Stat cards
    const totalCap = rows.filter(r => r.marketCap).reduce((s, r) => s + (r.marketCap || 0), 0);
    setHTML('statMarketCap', totalCap > 0 ? '₨' + totalCap.toLocaleString('en-US',{maximumFractionDigits:0}) + 'B' : '—');
    const totalVol = rows.reduce((s, r) => s + (r.volume || 0), 0);
    setHTML('statVolume', fmtVol(totalVol));
    setHTML('statAD', `<span class="text-emerald-400">${breadth.advances} ▲</span> / <span class="text-rose-400">${breadth.declines} ▼</span>`);

    // Sentiment
    const idxM = indexData?.meta || {};
    let idxP = idxM.price, idxPv = idxM.previousClose;
    if ((!idxP || idxP === 0) && indexData?.prices?.length) idxP = indexData.prices[indexData.prices.length-1][1];
    if ((!idxPv || idxPv === 0) && indexData?.prices?.length >= 2) idxPv = indexData.prices[indexData.prices.length-2][1];
    const idxChg = (idxP && idxPv) ? ((idxP - idxPv) / idxPv) * 100 : null;

    let sentScore = 0;
    if (breadth.marketBias === 'Bullish') sentScore += 2;
    else if (breadth.marketBias === 'Bearish') sentScore -= 2;
    if (idxChg != null) { sentScore += idxChg > 1 ? 2 : idxChg > 0 ? 1 : idxChg < -1 ? -2 : -1; }
    if (breadth.advanceDeclineRatio > 0.6) sentScore += 1;
    else if (breadth.advanceDeclineRatio < 0.4) sentScore -= 1;

    let sentEmoji, sentLabel, sentColor, sentPct;
    if (sentScore >= 3) { sentEmoji = '🐂'; sentLabel = 'Bullish'; sentColor = 'text-emerald-400'; sentPct = 75; }
    else if (sentScore >= 1) { sentEmoji = '📈'; sentLabel = 'Mildly Bullish'; sentColor = 'text-emerald-300'; sentPct = 55; }
    else if (sentScore > -1) { sentEmoji = '⚖️'; sentLabel = 'Neutral'; sentColor = 'text-amber-400'; sentPct = 50; }
    else if (sentScore > -3) { sentEmoji = '📉'; sentLabel = 'Mildly Bearish'; sentColor = 'text-orange-400'; sentPct = 35; }
    else { sentEmoji = '🐻'; sentLabel = 'Bearish'; sentColor = 'text-rose-400'; sentPct = 20; }

    setHTML('sentimentEmoji', sentEmoji);
    const labelEl = document.getElementById('sentimentLabel');
    if (labelEl) { labelEl.textContent = sentLabel; labelEl.className = 'text-xl font-bold mb-1 ' + sentColor; }
    setHTML('sentimentBar', `<div class="w-full bg-white/5 rounded-full h-2 overflow-hidden"><div class="h-full rounded-full transition-all duration-700 ${sentColor.replace('text-','bg-')}" style="width:${sentPct}%"></div></div>`);
  }

  // ════════════════════════════════════════════
  // VIEW: Watchlist
  // ════════════════════════════════════════════
  async function renderWatchlist() {
    const tok = newSeq();
    main().innerHTML = `<div class="space-y-3">${UI.skeletonCard(3)}${Array(5).fill(UI.skeletonCard(2)).join('')}</div>`;
    try {
      if (!state.watchlist.length) {
        main().innerHTML = `<div class="fade-in"><div class="glass p-8 text-center">
          <div class="text-4xl mb-3">⭐</div>
          <div class="text-lg font-semibold mb-1">No Stocks in Watchlist</div>
          <div class="text-dim text-sm mb-4">Use the search bar to add KSE-100 stocks to your watchlist.</div>
          <button onclick="App.navigate('search')" class="px-5 py-2 rounded-lg bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 transition text-sm"><i class="fas fa-search mr-2"></i> Search Stocks</button>
        </div></div>`;
        return;
      }

      // Render shell with search bar
      main().innerHTML = `<div class="fade-in space-y-4">
        <div class="glass p-4">
          <div class="flex items-center gap-3">
            <i class="fas fa-search text-dim"></i>
            <input id="wlSearch" type="text" placeholder="Add a stock to watchlist…" autocomplete="off"
              class="flex-1 bg-transparent outline-none text-sm placeholder:text-dim">
            <div id="wlSearchResults" class="absolute z-50 glass mt-2 search-dropdown hidden" style="top:100%;left:0;right:0;"></div>
          </div>
        </div>
        <div class="glass overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-dim text-xs uppercase tracking-wider border-b border-navy-700/50">
              <th class="text-left p-3">Symbol</th><th class="text-left p-3">Name</th>
              <th class="text-right p-3">Price (PKR)</th><th class="text-right p-3">Change%</th>
              <th class="text-right p-3 hidden sm:table-cell">Volume</th>
              <th class="text-right p-3 hidden md:table-cell">RSI</th>
              <th class="text-right p-3 hidden md:table-cell">MACD</th>
              <th class="text-center p-3 hidden lg:table-cell">Trend</th>
              <th class="text-center p-3">Rating</th>
              <th class="p-3"></th>
            </tr></thead>
            <tbody id="wlTableBody">${state.watchlist.map(() =>
              `<tr class="watchlist-row"><td colspan="10" class="p-3">${UI.skeleton('h-5','w-full')}</td></tr>`
            ).join('')}</tbody>
          </table>
        </div>
      </div>`;

      // Setup search
      setupWatchlistSearch();

      // Fetch and render
      const snaps = await API.snapshots(state.watchlist);
      if (!isCurrent(tok)) return;
      renderWatchlistRows(snaps, tok, 0);
    } catch (e) {
      if (!isCurrent(tok)) return;
      main().innerHTML = UI.errorCard('Failed to load watchlist data.', "App.navigate('watchlist')");
    }
  }

  function setupWatchlistSearch() {
    const input = document.getElementById('wlSearch');
    if (!input) return;
    let resultsDiv = null;

    input.addEventListener('input', () => {
      if (!resultsDiv) resultsDiv = document.getElementById('wlSearchResults');
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { if (resultsDiv) resultsDiv.classList.add('hidden'); return; }
      const matches = KSE100_STOCKS.filter(s =>
        (s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)) &&
        !state.watchlist.includes(s.symbol)
      ).slice(0, 8);
      if (!resultsDiv) return;
      resultsDiv.innerHTML = matches.length ? matches.map(s => `
        <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 cursor-pointer transition" onclick="App.addToWatchlist('${s.symbol}')">
          <span class="text-sm font-medium">${s.symbol.replace('.KA','')}</span>
          <span class="text-xs text-dim flex-1 truncate">${s.name}</span>
          <span class="text-xs text-teal-400">+ Add</span>
        </div>`).join('') : `<div class="p-3 text-xs text-dim">No matching stocks found</div>`;
      resultsDiv.classList.remove('hidden');
      resultsDiv.style.top = (input.getBoundingClientRect().bottom - input.parentElement.parentElement.getBoundingClientRect().top + 4) + 'px';
      resultsDiv.style.left = input.parentElement.getBoundingClientRect().left + 'px';
      resultsDiv.style.width = input.parentElement.offsetWidth + 'px';
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#wlSearch') && !e.target.closest('#wlSearchResults')) {
        if (resultsDiv) resultsDiv.classList.add('hidden');
      }
    });
  }

  async function renderWatchlistRows(snaps, tok, _depth) {
    if (!isCurrent(tok)) return;
    const cur = state.currency;
    const ordered = state.watchlist.map(sym => snaps[sym]).filter(Boolean);
    ordered.forEach(r => {
      const m = STOCK_MAP[r.symbol];
      if (m) { r.name = m.name; r.sector = m.sector; }
    });

    const tbody = document.getElementById('wlTableBody');
    if (!tbody) return;

    // Initial render with price data only (indicators say "loading")
    tbody.innerHTML = ordered.map(c => `
      <tr class="watchlist-row" onclick="App.navigate('stock','${c.symbol}')" style="cursor:pointer">
        <td class="p-3 font-semibold text-teal-300">${(c.symbol||'').replace('.KA','')}</td>
        <td class="p-3 text-xs truncate max-w-[120px]">${c.name || STOCK_MAP[c.symbol]?.name || c.symbol}</td>
        <td class="p-3 text-right">${UI.money(c.price, cur)}</td>
        <td class="p-3 text-right">${UI.pct(c.changePct)}</td>
        <td class="p-3 text-right hidden sm:table-cell text-xs">${fmtVol(c.volume)}</td>
        <td class="p-3 text-right hidden md:table-cell"><span id="wl-rsi-${cssId(c.symbol)}" class="text-dim">…</span></td>
        <td class="p-3 text-right hidden md:table-cell"><span id="wl-macd-${cssId(c.symbol)}" class="text-dim">…</span></td>
        <td class="p-3 text-center hidden lg:table-cell"><span id="wl-trend-${cssId(c.symbol)}" class="text-dim">…</span></td>
        <td class="p-3 text-center"><span id="wl-rating-${cssId(c.symbol)}">${UI.skeleton('h-5','w-16')}</span></td>
        <td class="p-3"><button onclick="event.stopPropagation();App.removeFromWatchlist('${c.symbol}')" class="text-dim hover:text-rose-400 transition" title="Remove"><i class="fas fa-times"></i></button></td>
      </tr>`).join('');

    // Load indicators one by one
    for (const c of ordered) {
      if (!isCurrent(tok)) return;
      try {
        const chart = await API.chartForAnalysis(c.symbol, IND_DAYS);
        const prices = chart.prices.map(p => p[1]);
        const vols = chart.total_volumes.map(v => v[1]);
        const ind = Indicators.analyze(prices, vols);
        const meta = STOCK_MAP[c.symbol] || null;
        const sectorCtx = getSectorContextFor(c.symbol);
        const rec = Recommend.recommend(ind, meta, sectorCtx);
        setHTML('wl-rsi-' + cssId(c.symbol), `<span class="${ind.rsi>70?'text-rose-400':ind.rsi<30?'text-emerald-400':''}">${ind.rsi?.toFixed(0)??'—'}</span>`);
        const macdCls = ind.macd.momentum === 'bullish' ? 'text-emerald-400' : 'text-rose-400';
        setHTML('wl-macd-' + cssId(c.symbol), `<span class="${macdCls}">${ind.macd.momentum}</span>`);
        const trendCls = ind.maTrend === 'up' ? 'text-emerald-400' : 'text-rose-400';
        setHTML('wl-trend-' + cssId(c.symbol), `<span class="${trendCls}">${ind.maTrend==='up'?'↑':'↓'}</span>`);
        setHTML('wl-rating-' + cssId(c.symbol), UI.ratingBadge(rec.rating, true));
      } catch {
        setHTML('wl-rating-' + cssId(c.symbol), '<span class="text-dim text-xs">N/A</span>');
      }
    }
  }

  function getSectorContextFor(symbol) {
    const meta = STOCK_MAP[symbol];
    if (!meta) return null;
    const priceMap = {};

    // Quick pass: try to use recently cached snapshots
    // This is approximate — full breadth requires more data
    return null; // Simplified for watchlist
  }

  function addToWatchlist(symbol) {
    if (!state.watchlist.includes(symbol)) {
      state.watchlist.push(symbol);
      saveWatchlist();
      UI.toast(`${symbol.replace('.KA','')} added to watchlist`);
      navigate('watchlist');
    } else {
      UI.toast('Already in watchlist');
    }
  }

  /** Silent add — persists + toasts once, but does NOT navigate. Idempotent. */
  function addToWatchlistSilent(symbol) {
    if (!state.watchlist.includes(symbol)) {
      state.watchlist.push(symbol);
      saveWatchlist();
      UI.toast(`${symbol.replace('.KA','')} added to your watchlist (KSE-100)`);
    }
  }

  /**
   * Look up ANY PSX symbol (not just KSE-100). Normalizes ticker, fetches live chart,
   * and navigates to stock detail on success. Shows toast on failure.
   */
  async function lookupSymbol(query) {
    const raw = (query || '').trim().toUpperCase().replace(/\s+/g, '');
    const symbol = raw.endsWith('.KA') ? raw : raw + '.KA';

    UI.toast(`Checking ${symbol}…`);

    try {
      const data = await API.fetchChart(symbol, '5d', '1d');
      const price = data?.meta?.price;
      const hasPrices = data?.prices?.length > 0;

      if ((price != null && price > 0) || hasPrices) {
        navigate('stock', symbol);
      } else {
        UI.toast(`No live data found for ${symbol} on PSX`);
      }
    } catch (e) {
      UI.toast(`No live data found for ${symbol} on PSX`);
    }
  }

  function removeFromWatchlist(symbol) {
    state.watchlist = state.watchlist.filter(s => s !== symbol);
    saveWatchlist();
    UI.toast(`${symbol.replace('.KA','')} removed`);
    if (state.route === 'watchlist') navigate('watchlist');
  }

  // ════════════════════════════════════════════
  // VIEW: Sectors
  // ════════════════════════════════════════════
  async function renderSectors() {
    const tok = newSeq();
    main().innerHTML = `<div class="space-y-3">${Array(6).fill(UI.skeletonCard(3)).join('')}</div>`;
    try {
      const allSyms = KSE100_STOCKS.map(s => s.symbol);
      const snaps = await API.allSnapshots(allSyms);
      if (!isCurrent(tok)) return;

      const priceMap = {};
      Object.values(snaps).forEach(s => {
        if (s.changePct != null) priceMap[s.symbol] = { price: s.price, changePct: s.changePct, volume: s.volume };
      });
      const perf = Sectors.sectorPerformance(priceMap);
      const grouped = Sectors.groupBySector(KSE100_STOCKS);

      main().innerHTML = `<div class="fade-in space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">📊 Sector Analysis</h2>
          <span class="text-dim text-xs">${perf.length} sectors · ${KSE100_STOCKS.length} stocks</span>
        </div>
        <div class="grid gap-4 md:grid-cols-2">${perf.map(sec => {
          const stocks = grouped[sec.sector] || [];
          const maxAbs = Math.max(...perf.map(s => Math.abs(s.avgChange)), 0.01);
          const barW = Math.min(100, (Math.abs(sec.avgChange) / maxAbs) * 100);
          const pos = sec.avgChange >= 0;
          const colorClass = Sectors.sectorColor(sec.avgChange);
          return `<div class="glass p-4 glass-hover" onclick="App.toggleSectorStocks('${cssId(sec.sector)}')">
            <div class="flex items-center justify-between mb-2">
              <div class="font-semibold text-sm">${sec.sector}</div>
              <div class="${colorClass} font-bold text-sm">${pos?'+':''}${sec.avgChange.toFixed(2)}%</div>
            </div>
            <div class="flex items-center gap-3 text-xs text-dim mb-2">
              <span>${sec.trackedCount} stocks</span>
              <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> ${sec.upCount}
              <span class="w-2 h-2 rounded-full bg-rose-400 inline-block"></span> ${sec.downCount}
            </div>
            <div class="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
              <div class="sector-bar h-full ${pos?'bg-emerald-400':'bg-rose-400'} rounded-full" style="width:${barW}%"></div>
            </div>
            <div id="sec-${cssId(sec.sector)}" class="hidden mt-3 pt-3 border-t border-navy-700/50 space-y-1">
              ${stocks.map(st => {
                const snap = snaps[st.symbol];
                const chg = snap?.changePct;
                return `<div class="flex items-center justify-between text-xs py-1 hover:bg-white/5 rounded px-2 cursor-pointer transition" onclick="event.stopPropagation();App.navigate('stock','${st.symbol}')">
                  <span class="font-medium">${st.symbol.replace('.KA','')}</span>
                  <span class="text-dim truncate mx-2 flex-1">${st.name}</span>
                  <span>${snap?.price != null ? UI.money(snap.price) : '—'}</span>
                  <span class="w-16 text-right">${chg != null ? UI.pct(chg) : '—'}</span>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}</div>
      </div>`;
    } catch (e) {
      if (!isCurrent(tok)) return;
      main().innerHTML = UI.errorCard('Failed to load sector data.', "App.navigate('sectors')");
    }
  }

  function toggleSectorStocks(secId) {
    const el = document.getElementById('sec-' + secId);
    if (el) el.classList.toggle('hidden');
  }

  // ════════════════════════════════════════════
  // VIEW: Market Breadth
  // ════════════════════════════════════════════
  async function renderMarketBreadth() {
    const tok = newSeq();
    main().innerHTML = `<div class="space-y-4">${Array(4).fill(UI.skeletonCard(4)).join('')}</div>`;
    try {
      const allSyms = KSE100_STOCKS.map(s => s.symbol);
      const snaps = await API.allSnapshots(allSyms);
      if (!isCurrent(tok)) return;

      const priceMap = {};
      const rows = [];
      Object.values(snaps).forEach(s => {
        if (s.changePct != null) {
          priceMap[s.symbol] = { price: s.price, changePct: s.changePct, volume: s.volume };
          const m = STOCK_MAP[s.symbol];
          rows.push({ ...s, name: m?.name || s.symbol, sector: m?.sector || '' });
        }
      });
      const breadth = Sectors.marketBreadth(priceMap);

      // Advancers / Decliners lists
      const advancers = rows.filter(r => r.changePct > 0).sort((a,b) => b.changePct - a.changePct).slice(0, 10);
      const decliners = rows.filter(r => r.changePct < 0).sort((a,b) => a.changePct - b.changePct).slice(0, 10);

      const adRatio = breadth.advanceDeclineRatio;
      const gaugePct = Math.round(adRatio * 100);
      const bias = breadth.marketBias;
      const biasColor = bias === 'Bullish' ? 'text-emerald-400' : bias === 'Bearish' ? 'text-rose-400' : 'text-amber-400';

      main().innerHTML = `<div class="fade-in space-y-5">
        <h2 class="text-lg font-bold"><i class="fas fa-chart-bar text-teal-400 mr-2"></i>Market Breadth</h2>

        <!-- Big gauge -->
        <div class="glass p-6 text-center">
          <div class="text-5xl font-bold ${biasColor} mb-2">${bias}</div>
          <div class="text-dim text-sm mb-4">Market Bias</div>
          <div class="flex items-center gap-3 justify-center">
            <span class="text-rose-400 text-sm">Bearish</span>
            <div class="w-64 h-3 bg-white/5 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-700 ${bias==='Bullish'?'bg-emerald-400':bias==='Bearish'?'bg-rose-400':'bg-amber-400'}" style="width:${gaugePct}%"></div>
            </div>
            <span class="text-emerald-400 text-sm">Bullish</span>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="glass p-4 text-center">
            <div class="text-2xl font-bold text-emerald-400">${breadth.advances}</div>
            <div class="text-xs text-dim mt-1">Advancing</div>
          </div>
          <div class="glass p-4 text-center">
            <div class="text-2xl font-bold text-rose-400">${breadth.declines}</div>
            <div class="text-xs text-dim mt-1">Declining</div>
          </div>
          <div class="glass p-4 text-center">
            <div class="text-2xl font-bold">${breadth.advanceDeclineRatio}</div>
            <div class="text-xs text-dim mt-1">A/D Ratio</div>
          </div>
          <div class="glass p-4 text-center">
            <div class="text-2xl font-bold">${breadth.upDownVolumeRatio}</div>
            <div class="text-xs text-dim mt-1">Up/Down Vol Ratio</div>
          </div>
        </div>

        <!-- Top Advancers / Decliners -->
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="glass p-4">
            <div class="font-semibold text-sm mb-3 text-emerald-400">▲ Top Advancers</div>
            <div class="space-y-1">${advancers.length ? advancers.map(r => `
              <div class="flex items-center gap-2 py-1.5 text-xs cursor-pointer hover:bg-white/5 rounded px-2 transition" onclick="App.navigate('stock','${r.symbol}')">
                <span class="font-semibold w-16 text-teal-300">${r.symbol.replace('.KA','')}</span>
                <span class="text-dim truncate flex-1">${r.name}</span>
                <span>${UI.money(r.price, state.currency, {compact:true})}</span>
                <span class="text-emerald-400 w-16 text-right">+${r.changePct.toFixed(2)}%</span>
              </div>`).join('') : dimNote('No advancers')}</div>
          </div>
          <div class="glass p-4">
            <div class="font-semibold text-sm mb-3 text-rose-400">▼ Top Decliners</div>
            <div class="space-y-1">${decliners.length ? decliners.map(r => `
              <div class="flex items-center gap-2 py-1.5 text-xs cursor-pointer hover:bg-white/5 rounded px-2 transition" onclick="App.navigate('stock','${r.symbol}')">
                <span class="font-semibold w-16 text-teal-300">${r.symbol.replace('.KA','')}</span>
                <span class="text-dim truncate flex-1">${r.name}</span>
                <span>${UI.money(r.price, state.currency, {compact:true})}</span>
                <span class="text-rose-400 w-16 text-right">${r.changePct.toFixed(2)}%</span>
              </div>`).join('') : dimNote('No decliners')}</div>
          </div>
        </div>
      </div>`;
    } catch (e) {
      if (!isCurrent(tok)) return;
      main().innerHTML = UI.errorCard('Failed to load market breadth.', "App.navigate('market')");
    }
  }

  // ════════════════════════════════════════════
  // VIEW: KSE-100 Index
  // ════════════════════════════════════════════
  async function renderIndexView() {
    const tok = newSeq();
    main().innerHTML = `<div class="space-y-4">${UI.skeletonCard(5)}${UI.skeletonCard(6)}</div>`;
    try {
      const rangeKey = state.chartRange || '3mo';
      const { range, interval } = chartTimeframe(rangeKey);
      const data = await API.kse100IndexWithInterval(range, interval);
      if (!isCurrent(tok)) return;

      const m = data.meta || {};
      let price = m.price, prevClose = m.previousClose;
      if ((!price || price === 0) && data.prices?.length) price = data.prices[data.prices.length-1][1];
      if ((!prevClose || prevClose === 0) && data.prices?.length >= 2) prevClose = data.prices[data.prices.length-2][1];
      const changePct = (price && prevClose) ? ((price - prevClose) / prevClose) * 100 : null;

      // Compute indicators on index prices (use analysis chart for long-term; skip for intraday)
      const analysisChart = await API.chartForAnalysis('^KSE', IND_DAYS);
      const iprices = analysisChart.prices.map(p => p[1]);
      const ivols = analysisChart.total_volumes.map(v => v[1]);
      const ind = Indicators.analyze(iprices, ivols);
      const rec = Recommend.recommend(ind, null, null);

      const macdCls = ind.macd.momentum === 'bullish' ? 'text-emerald-400' : 'text-rose-400';
      const allTimeframes = ['1d','5d','1mo','3mo','6mo','1y','5y'];

      main().innerHTML = `<div class="fade-in space-y-5">
        <!-- Header -->
        <div class="glass p-5">
          <div class="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 class="text-lg font-bold">🏛️ KSE-100 Index</h2>
              <div class="text-dim text-xs">Pakistan Stock Exchange — Benchmark Index</div>
            </div>
            <div class="text-right">
              <div class="text-3xl font-bold">${price ? price.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}</div>
              <div class="text-sm">${UI.pct(changePct)}</div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-navy-700/50">
            <div><div class="text-dim text-[10px] uppercase">52-Week High</div><div class="text-sm">${m.high52w ? m.high52w.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}</div></div>
            <div><div class="text-dim text-[10px] uppercase">52-Week Low</div><div class="text-sm">${m.low52w ? m.low52w.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}</div></div>
            <div><div class="text-dim text-[10px] uppercase">Daily Change</div><div class="text-sm">${changePct != null ? (changePct>=0?'+':'')+changePct.toFixed(2)+'%' : '—'}</div></div>
            <div><div class="text-dim text-[10px] uppercase">Previous Close</div><div class="text-sm">${prevClose ? prevClose.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}</div></div>
          </div>
        </div>

        <!-- Chart -->
        <div class="glass p-5">
          <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div class="font-semibold">Price Chart</div>
            <div class="flex gap-1.5 flex-wrap">
              ${allTimeframes.map(r => `<button onclick="App.setIndexRange('${r}')" class="px-3 py-1 rounded-lg text-xs border ${state.chartRange===r?'bg-teal-500/20 text-teal-300 border-teal-500/30':'border-transparent text-dim hover:text-slate-300'} transition">${r.toUpperCase()}</button>`).join('')}
            </div>
          </div>
          <div style="height:350px"><canvas id="indexChart"></canvas></div>
        </div>

        <!-- Indicators -->
        <div class="glass p-5">
          <div class="font-semibold mb-3">📈 Technical Indicators</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="p-3 rounded-lg bg-white/[0.03]">
              <div class="text-[10px] text-dim uppercase">RSI (14)</div>
              <div class="text-lg font-bold ${ind.rsi>70?'text-rose-400':ind.rsi<30?'text-emerald-400':''}">${ind.rsi?.toFixed(1)??'—'}</div>
              <div class="text-[10px] text-dim">${ind.rsi>70?'Overbought':ind.rsi<30?'Oversold':'Neutral'}</div>
            </div>
            <div class="p-3 rounded-lg bg-white/[0.03]">
              <div class="text-[10px] text-dim uppercase">MACD</div>
              <div class="text-lg font-bold ${macdCls}">${ind.macd.momentum}</div>
              <div class="text-[10px] text-dim">${ind.macd.cross !== 'none' ? ind.macd.cross + ' cross' : 'steady'}</div>
            </div>
            <div class="p-3 rounded-lg bg-white/[0.03]">
              <div class="text-[10px] text-dim uppercase">EMA 20/50/200</div>
              <div class="text-xs">
                <span class="text-teal-300">20:</span> ${ind.ema20?.toFixed(0)??'—'}<br>
                <span class="text-amber-300">50:</span> ${ind.ema50?.toFixed(0)??'—'}<br>
                <span class="text-dim">200:</span> ${ind.ema200?.toFixed(0)??'—'}
              </div>
            </div>
            <div class="p-3 rounded-lg bg-white/[0.03]">
              <div class="text-[10px] text-dim uppercase">Trend</div>
              <div class="text-lg font-bold ${ind.maTrend==='up'?'text-emerald-400':'text-rose-400'}">${ind.maTrend==='up'?'↑ UP':'↓ DOWN'}</div>
              <div class="text-[10px] text-dim">vs 50-day EMA</div>
            </div>
          </div>
        </div>

        <!-- Rating Card -->
        <div class="glass p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="font-semibold">🧠 AI Index Rating</div>
            ${UI.ratingBadge(rec.rating)}
          </div>
          <div class="text-xs text-dim mb-3">Rule-based technical analysis of KSE-100 index — ${rec.confidence}% confidence</div>
          <ul class="space-y-1.5 text-sm">${rec.reasons.map(r => `<li class="flex gap-2"><span class="text-amber-400">•</span><span>${r}</span></li>`).join('')}</ul>
        </div>
      </div>`;

      // Draw chart after DOM update
      setTimeout(() => drawChart('indexChart', data, changePct >= 0, rangeKey), 50);
    } catch (e) {
      if (!isCurrent(tok)) return;
      main().innerHTML = UI.errorCard('Failed to load KSE-100 index data.', "App.navigate('index')");
    }
  }

  function setIndexRange(range) {
    state.chartRange = range;
    navigate('index');
  }

  // ════════════════════════════════════════════
  // VIEW: Stock Detail
  // ════════════════════════════════════════════
  async function renderStockDetail(symbol) {
    if (!symbol) return navigate('dashboard');
    const tok = newSeq();
    const cur = state.currency;
    const isIndex = symbol === '^KSE';
    const isKse100 = STOCK_MAP[symbol] != null;
    const meta = isKse100 ? STOCK_MAP[symbol] : null;

    main().innerHTML = `<div class="space-y-4">${UI.skeletonCard(4)}${UI.skeletonCard(8)}</div>`;

    try {
      const rangeKey = state.chartRange || '3mo';
      const { range, interval } = chartTimeframe(rangeKey);
      const displayChart = await API.chartForDisplayWithInterval(symbol, range, interval);
      const analysisChart = await API.chartForAnalysis(symbol, IND_DAYS);
      if (!isCurrent(tok)) return;

      // Auto-add KSE-100 stocks silently on detail view
      if (isKse100) addToWatchlistSilent(symbol);

      const m = analysisChart.meta || {};
      const prices = analysisChart.prices.map(p => p[1]);
      const vols = analysisChart.total_volumes.map(v => v[1]);
      const ind = Indicators.analyze(prices, vols);
      const sectorCtx = null;
      const rec = Recommend.recommend(ind, meta, sectorCtx);

      let price = m.price;
      let prevClose = m.previousClose;
      if ((!price || price === 0) && prices.length) price = prices[prices.length-1];
      if ((!prevClose || prevClose === 0) && prices.length >= 2) prevClose = prices[prices.length-2];
      const changePct = (price && prevClose) ? ((price - prevClose) / prevClose) * 100 : null;
      const inWatch = state.watchlist.includes(symbol);
      const displayName = m.name || symbol;
      const displaySector = meta?.sector || '—';
      const displayCap = meta?.marketCap ? ('₨'+meta.marketCap+'B') : '—';
      const displayPE = meta?.peRatio != null ? (meta.peRatio.toFixed(1)+'x') : '—';

      const macdCls = ind.macd.momentum === 'bullish' ? 'text-emerald-400' : 'text-rose-400';
      const allTimeframes = ['1d','5d','1mo','3mo','6mo','1y','5y'];

      main().innerHTML = `<div class="fade-in space-y-5">
        <!-- Header -->
        <div class="glass p-5">
          <div class="flex items-start justify-between flex-wrap gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500/30 to-emerald-500/30 flex items-center justify-center font-bold text-teal-300">${isIndex?'KSE':symbol.replace('.KA','').slice(0,4)}</div>
              <div>
                <div class="text-xl font-bold">${displayName}</div>
                ${isIndex ? '<div class="text-dim text-xs">KSE-100 Index · PSX</div>'
                  : `<div class="text-dim text-xs">${symbol.replace('.KA','')} · ${displaySector}</div>`}
              </div>
            </div>
            <div class="text-right">
              <div class="text-3xl font-bold">${isIndex ? (price?price.toLocaleString('en-US',{maximumFractionDigits:0}):'—') : UI.money(price, cur)}</div>
              <div class="text-sm">${UI.pct(changePct)}</div>
            </div>
            ${isIndex ? '' : (isKse100 ? `
              <button onclick="App.toggleWatchlistStock('${symbol}')" class="px-4 py-2 rounded-lg text-sm font-medium transition
                ${inWatch ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                          : 'bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25'}">
                ${inWatch ? '<i class="fas fa-times mr-1"></i> Remove from Watchlist' : '<i class="fas fa-plus mr-1"></i> Add to Watchlist'}
              </button>` : `
              ${inWatch ? `<button onclick="App.toggleWatchlistStock('${symbol}')" class="px-4 py-2 rounded-lg text-sm font-medium transition bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25"><i class="fas fa-times mr-1"></i> Remove from Watchlist</button>`
                        : `<button onclick="App.trackCustomStock('${symbol}')" class="px-4 py-2 rounded-lg text-sm font-medium transition bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25">➕ Track this stock</button>`}
            `)}
          </div>
          <!-- Company info -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-navy-700/50">
            <div><div class="text-dim text-[10px] uppercase">52-Wk High</div><div class="text-sm">${m.high52w ? UI.money(m.high52w, cur) : '—'}</div></div>
            <div><div class="text-dim text-[10px] uppercase">52-Wk Low</div><div class="text-sm">${m.low52w ? UI.money(m.low52w, cur) : '—'}</div></div>
            ${isIndex ? '' : `<div><div class="text-dim text-[10px] uppercase">Market Cap</div><div class="text-sm">${displayCap}</div></div>
            <div><div class="text-dim text-[10px] uppercase">P/E Ratio</div><div class="text-sm">${displayPE}</div></div>`}
            ${isIndex ? `<div><div class="text-dim text-[10px] uppercase">Exchange</div><div class="text-sm">PSX</div></div>
            <div><div class="text-dim text-[10px] uppercase">Currency</div><div class="text-sm">PKR</div></div>` : ''}
          </div>
        </div>

        <!-- Chart -->
        <div class="glass p-5">
          <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div class="font-semibold">Price Chart</div>
            <div class="flex gap-1.5 flex-wrap">
              ${allTimeframes.map(r => `<button onclick="App.setStockRange('${symbol}','${r}')" class="px-3 py-1 rounded-lg text-xs border ${state.chartRange===r?'bg-teal-500/20 text-teal-300 border-teal-500/30':'border-transparent text-dim hover:text-slate-300'} transition">${r.toUpperCase()}</button>`).join('')}
            </div>
          </div>
          <div style="height:350px"><canvas id="stockDetailChart"></canvas></div>
        </div>

        <!-- Indicators + Recommendation -->
        <div class="grid gap-4 lg:grid-cols-2">
          <!-- Technical Indicators Grid -->
          <div class="glass p-5">
            <div class="font-semibold mb-3">📊 Technical Indicators</div>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">RSI (14)</div><div class="text-lg font-bold ${ind.rsi>70?'text-rose-400':ind.rsi<30?'text-emerald-400':''}">${ind.rsi?.toFixed(1)??'—'}</div><div class="text-[10px] text-dim">${ind.rsi>70?'Overbought':ind.rsi<30?'Oversold':'Neutral'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">MACD</div><div class="text-lg font-bold ${macdCls}">${ind.macd.momentum}</div><div class="text-[10px] text-dim">${ind.macd.cross !== 'none' ? ind.macd.cross + ' cross' : 'no cross'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">EMA 20</div><div class="text-sm font-bold">${ind.ema20 ? UI.money(ind.ema20,cur) : '—'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">EMA 50</div><div class="text-sm font-bold">${ind.ema50 ? UI.money(ind.ema50,cur) : '—'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">EMA 200</div><div class="text-sm font-bold">${ind.ema200 ? UI.money(ind.ema200,cur) : '—'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">Bollinger</div><div class="text-xs">${ind.bbLower ? UI.money(ind.bbLower,cur) : '—'} – ${ind.bbUpper ? UI.money(ind.bbUpper,cur) : '—'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">Support</div><div class="text-sm font-bold text-emerald-400">${ind.support ? UI.money(ind.support,cur) : '—'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">Resistance</div><div class="text-sm font-bold text-rose-400">${ind.resistance ? UI.money(ind.resistance,cur) : '—'}</div></div>
            </div>
          </div>

          <!-- AI Recommendation -->
          <div class="glass p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="font-semibold">🧠 AI Recommendation</div>
              ${UI.ratingBadge(rec.rating)}
            </div>
            <div class="flex gap-4 mb-3 text-sm flex-wrap">
              <div><span class="text-dim">Confidence</span> <span class="font-medium">${rec.confidence}%</span></div>
              <div><span class="text-dim">Risk</span> <span class="font-medium">${rec.risk}</span></div>
              <div><span class="text-dim">Score</span> <span class="font-medium">${rec.score}</span></div>
            </div>
            <div class="text-[10px] text-dim uppercase tracking-wider mb-1.5">Reasons</div>
            <ul class="space-y-1.5 text-sm mb-4">${rec.reasons.map(r => `<li class="flex gap-2"><span class="text-amber-400">•</span><span>${r}</span></li>`).join('')}</ul>
            <div class="text-xs space-y-1.5 border-t border-navy-700/50 pt-3">
              <div><span class="text-dim">Entry:</span> ${rec.entry}</div>
              <div><span class="text-dim">Exit:</span> ${rec.exit}</div>
              <div><span class="text-dim">Target:</span> ${rec.target ? UI.money(rec.target, cur) : '—'} · <span class="text-dim">Stop:</span> ${rec.stopLoss ? UI.money(rec.stopLoss, cur) : '—'}</div>
            </div>
            <div class="mt-3 text-[10px] text-dim">Rule-based technical analysis — not financial advice.</div>
          </div>
        </div>
      </div>`;

      setTimeout(() => drawChart('stockDetailChart', displayChart, changePct >= 0, rangeKey), 50);
    } catch (e) {
      if (!isCurrent(tok)) return;
      main().innerHTML = UI.errorCard(`Failed to load data for ${symbol}.`, `App.navigate('stock','${symbol}')`);
    }
  }

  function setStockRange(symbol, range) {
    state.chartRange = range;
    navigate('stock', symbol);
  }

  function toggleWatchlistStock(symbol) {
    if (state.watchlist.includes(symbol)) {
      state.watchlist = state.watchlist.filter(s => s !== symbol);
      UI.toast('Removed from watchlist');
    } else {
      state.watchlist.push(symbol);
      saveWatchlist();
      UI.toast('Added to watchlist');
    }
    navigate('stock', symbol);
  }

  /** Manual "Track this stock" for non-KSE-100 symbols — adds + persists + re-renders. */
  function trackCustomStock(symbol) {
    if (!state.watchlist.includes(symbol)) {
      state.watchlist.push(symbol);
      saveWatchlist();
      UI.toast(`${symbol.replace('.KA','')} added to your watchlist`);
    }
    navigate('stock', symbol);
  }

  // ════════════════════════════════════════════
  // VIEW: Search
  // ════════════════════════════════════════════
  function renderSearchView() {
    newSeq();
    main().innerHTML = `<div class="fade-in space-y-4">
      <div class="glass p-5">
        <div class="flex items-center gap-3">
          <i class="fas fa-search text-dim text-lg"></i>
          <input id="mainSearch" type="text" placeholder="Search KSE-100 stocks by name or symbol…" autocomplete="off"
            class="flex-1 bg-transparent outline-none text-lg placeholder:text-dim">
        </div>
      </div>
      <div id="searchResultsArea" class="space-y-2">
        <div class="text-dim text-sm py-4 text-center">Type to search across all ${KSE100_STOCKS.length} KSE-100 constituents</div>
      </div>
    </div>`;

    const input = document.getElementById('mainSearch');
    const results = document.getElementById('searchResultsArea');
    if (!input || !results) return;

    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim().toLowerCase();
      if (!q) {
        results.innerHTML = `<div class="text-dim text-sm py-4 text-center">Type to search across all ${KSE100_STOCKS.length} KSE-100 constituents</div>`;
        return;
      }
      timer = setTimeout(() => {
        const matches = KSE100_STOCKS.filter(s =>
          s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q) || s.sector.toLowerCase().includes(q)
        ).slice(0, 15);

        // Build results HTML
        let html = '';

        if (matches.length) {
          html += matches.map(s => `
            <div class="glass glass-hover p-4 flex items-center gap-3" onclick="App.navigate('stock','${s.symbol}')">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500/20 to-emerald-500/20 flex items-center justify-center font-bold text-teal-300 text-xs">${s.symbol.replace('.KA','').slice(0,4)}</div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm">${s.name}</div>
                <div class="text-dim text-xs">${s.symbol.replace('.KA','')} · ${s.sector}</div>
              </div>
              <div class="text-xs text-dim">${s.sector}</div>
              <i class="fas fa-chevron-right text-dim text-sm ml-2"></i>
            </div>`).join('');
        }

        // If query looks like a ticker and wasn't matched in KSE-100, show a lookup card
        const cleanQ = q.toUpperCase().replace(/[^A-Z0-9.]/g, '');
        if (cleanQ.length >= 2 && !KSE100_STOCKS.some(s => s.symbol.toUpperCase().includes(cleanQ))) {
          const rawQ = input.value.trim();
          html += `
            <div class="glass glass-hover p-4 flex items-center gap-3 cursor-pointer border border-dashed border-teal-500/30" onclick="App.lookupSymbol('${rawQ.replace(/'/g, "\\'")}')">
              <div class="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <i class="fas fa-satellite text-teal-300"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-teal-300">🔍 Search PSX for '${rawQ.replace(/'/g, "\\'")}' — fetch live data</div>
                <div class="text-dim text-xs">Not in KSE-100? Look up any symbol on the exchange</div>
              </div>
              <i class="fas fa-arrow-right text-teal-300 text-sm ml-2"></i>
            </div>`;
        }

        results.innerHTML = html || `<div class="glass p-6 text-center text-dim">No stocks found matching "${input.value}"</div>`;
        input.focus();
      }, 200);
    });

    // Auto-focus on mount
    setTimeout(() => input && input.focus(), 100);
  }

  // ════════════════════════════════════════════
  // Chart.js Rendering
  // ════════════════════════════════════════════
  function drawChart(canvasId, chartData, isUp, rangeKey) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const prices = chartData.prices;
    if (!prices || !prices.length) return;

    // Format labels based on timeframe: intraday → time, daily+ → date
    const isIntraday = rangeKey === '1d' || rangeKey === '5d';
    const labels = prices.map(p => {
      const d = new Date(p[0]);
      if (isIntraday) {
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const data = prices.map(p => p[1]);
    const color = isUp ? '#2dd4bf' : '#fb7185';
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 350);
    grad.addColorStop(0, isUp ? 'rgba(45,212,191,0.22)' : 'rgba(251,113,133,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: color,
          backgroundColor: grad,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2340',
            titleColor: '#e2e8f0',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(45,212,191,0.3)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (c) => {
                const val = c.parsed.y;
                return val >= 1000 ? '₨' + val.toLocaleString('en-US', {maximumFractionDigits: 2})
                  : '₨' + val.toFixed(2);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#64748b',
              font: { size: 10 },
              callback: (v) => v >= 1000 ? (v/1000).toFixed(1) + 'K' : v.toFixed(1)
            }
          }
        }
      }
    });
  }

  // ════════════════════════════════════════════
  // Init
  // ════════════════════════════════════════════
  function init() {
    applyTheme();
    startTradingClock();
    startAutoRefresh();

    // Handle initial route from hash
    const hash = window.location.hash.replace('#', '');
    const [route, ...rest] = hash.split('/');
    const initialRoute = route || 'dashboard';
    const initialData = rest.join('/') || null;
    navigate(initialRoute, initialData);

    // Sidebar nav clicks
    document.querySelectorAll('[data-route]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const r = el.getAttribute('data-route');
        navigate(r);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  // ════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════
  return {
    navigate,
    toggleTheme,
    addToWatchlist,
    addToWatchlistSilent,
    removeFromWatchlist,
    toggleWatchlistStock,
    trackCustomStock,
    lookupSymbol,
    toggleSectorStocks,
    setIndexRange,
    setStockRange
  };
})();