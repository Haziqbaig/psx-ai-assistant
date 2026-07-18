/**
 * app.js — Main application: routing, views, state for StockSage AI (PSX).
 */
const App = (() => {
  const DEFAULT_WATCHLIST = ['OGDC.KA','ENGRO.KA','HUBC.KA','LUCK.KA','MEBL.KA','SYS.KA','FFC.KA','MARI.KA'];
  const IND_DAYS = 260; // ~1y trading days for EMA200 + 52w metrics

  const state = {
    view: 'dashboard',
    symbol: null,
    watchlist: JSON.parse(localStorage.getItem('ss_watchlist') || 'null') || DEFAULT_WATCHLIST.slice(),
    currency: 'pkr',
    theme: localStorage.getItem('ss_theme') || 'dark',
    chart: null,
    range: '3mo',
    chartType: localStorage.getItem('ss_chart_type') || 'line',
    recs: {},          // symbol → {rec, name, sym}
    snapshotCache: {}, // symbol → snapshot (session)
    sectorFilter: 'all',
    mkSort: 'change',
  };

  const alertsStore = JSON.parse(localStorage.getItem('ss_alerts') || 'null') || { alerts: [], history: [] };
  function saveAlerts() { localStorage.setItem('ss_alerts', JSON.stringify(alertsStore)); }

  const $ = (s) => document.querySelector(s);
  const viewEl = () => $('#view');

  let renderSeq = 0;
  const newRender = () => ++renderSeq;
  const isCurrent = (tok) => tok === renderSeq;

  function saveWatchlist() { localStorage.setItem('ss_watchlist', JSON.stringify(state.watchlist)); }

  function applyTheme() {
    document.documentElement.classList.toggle('light', state.theme === 'light');
    document.documentElement.classList.toggle('dark', state.theme !== 'light');
  }

  /** Navigate between views. */
  function nav(view, symbol = null) {
    newRender();
    state.view = view; state.symbol = symbol;
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('tab-active', b.dataset.nav === view));
    if (view === 'dashboard') renderDashboard();
    else if (view === 'watchlist') renderWatchlist();
    else if (view === 'sectors') renderSectors();
    else if (view === 'alerts') renderAlerts();
    else if (view === 'settings') renderSettings();
    else if (view === 'stock') renderStock(symbol);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Dashboard ---------------- */
  async function renderDashboard() {
    const tok = renderSeq;
    viewEl().innerHTML = `
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${UI.skeletonCard(2)}${UI.skeletonCard(2)}${UI.skeletonCard(2)}${UI.skeletonCard(2)}</div>
      <div class="mt-4 grid gap-4 lg:grid-cols-3">${UI.skeletonCard(6)}${UI.skeletonCard(6)}${UI.skeletonCard(6)}</div>`;
    try {
      // 1) KSE-100 index
      let indexData = null;
      try { indexData = await API.kse100Index('3mo'); } catch {}

      if (!isCurrent(tok)) return;

      // 2) Snapshots for a representative set (watchlist + top constituents) for gainers/losers/breadth
      const dashSymbols = [...new Set([
        ...state.watchlist,
        ...KSE100_STOCKS.slice(0, 40).map(s => s.symbol)
      ])];

      // Render shell with index card first, load the rest progressively
      renderDashboardShell(indexData, tok);

      const snaps = await API.allSnapshots(dashSymbols, 4);
      state.snapshotCache = { ...state.snapshotCache, ...snaps };
      if (!isCurrent(tok)) return;

      renderDashboardData(snaps, indexData, tok);
    } catch (e) {
      if (!isCurrent(tok)) return;
      viewEl().innerHTML = UI.errorCard('Failed to load market data. Yahoo Finance may be rate-limiting — retry in a moment.', "App.nav('dashboard')");
    }
  }

  function renderDashboardShell(indexData, tok) {
    if (!isCurrent(tok)) return;
    const idxMeta = indexData?.meta || {};
    let idxPrice = idxMeta.price;
    let idxPrev = idxMeta.previousClose;
    if ((!idxPrice || idxPrice === 0) && indexData?.prices?.length) {
      idxPrice = indexData.prices[indexData.prices.length - 1][1];
    }
    if ((!idxPrev || idxPrev === 0) && indexData?.prices?.length >= 2) {
      idxPrev = indexData.prices[indexData.prices.length - 2][1];
    }
    const idxChange = (idxPrice && idxPrev) ? ((idxPrice - idxPrev) / idxPrev) * 100 : null;

    viewEl().innerHTML = `
    <div class="fade-in space-y-4">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="glass glass-hover p-5 lg:col-span-2 border-l-2 border-l-amber-400/40">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs text-dim uppercase tracking-wider mb-1">KSE-100 Index</div>
              <div class="font-display text-3xl font-bold text-head">${idxPrice ? idxPrice.toLocaleString('en-US',{maximumFractionDigits:2}) : '—'}</div>
              <div class="text-sm mt-1">${UI.pct(idxChange)} <span class="text-dim text-xs">today</span></div>
            </div>
            <div class="text-right">
              <canvas id="idxSpark" width="120" height="48"></canvas>
              <button onclick="App.nav('stock','^KSE')" class="text-[11px] text-amber-400 hover:text-amber-300 mt-1">View chart →</button>
            </div>
          </div>
        </div>
        <div class="glass glass-hover p-5">
          <div class="text-xs text-dim uppercase tracking-wider mb-1">Market Breadth</div>
          <div id="breadthCard" class="font-display text-2xl font-bold text-head">${UI.skeleton('h-7','w-2/3')}</div>
          <div id="breadthSub" class="text-sm mt-1 text-dim text-xs">Loading advance/decline…</div>
        </div>
        <div class="glass glass-hover p-5">
          <div class="text-xs text-dim uppercase tracking-wider mb-1">Market Sentiment</div>
          <div id="sentimentCard" class="font-display text-2xl font-bold text-head">${UI.skeleton('h-7','w-2/3')}</div>
          <div id="sentimentSub" class="text-sm mt-1 text-dim text-xs">Computing…</div>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="glass p-5">
          <div class="font-display font-semibold text-head mb-2">🚀 Top Gainers <span class="text-xs text-dim font-normal">(today)</span></div>
          <div id="gainersList">${UI.skeleton('h-4','w-full')}<div class="mt-2">${UI.skeleton('h-4','w-full')}</div></div>
        </div>
        <div class="glass p-5">
          <div class="font-display font-semibold text-head mb-2">📉 Top Losers <span class="text-xs text-dim font-normal">(today)</span></div>
          <div id="losersList">${UI.skeleton('h-4','w-full')}<div class="mt-2">${UI.skeleton('h-4','w-full')}</div></div>
        </div>
        <div class="glass p-5">
          <div class="font-display font-semibold text-head mb-2">🔥 Most Active <span class="text-xs text-dim font-normal">(volume)</span></div>
          <div id="activeList">${UI.skeleton('h-4','w-full')}<div class="mt-2">${UI.skeleton('h-4','w-full')}</div></div>
        </div>
      </div>

      <div class="glass p-5" id="sectorSnapshot">
        <div class="flex items-center justify-between mb-3">
          <div class="font-display font-semibold text-head">📊 Sector Performance</div>
          <button onclick="App.nav('sectors')" class="text-[11px] text-amber-400 hover:text-amber-300">Full view →</button>
        </div>
        <div id="sectorBars">${UI.skeleton('h-4','w-full')}</div>
      </div>

      <div class="glass p-5" id="aiInsights">
        <div class="flex items-center justify-between mb-2">
          <div class="font-display font-semibold text-head">🧠 AI Market Insights <span class="text-xs text-dim font-normal">(rule-based)</span></div>
          <button onclick="App.regenInsights()" class="px-3 py-1.5 rounded-lg text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition">↻ Regenerate</button>
        </div>
        <ul id="aiInsightsList" class="space-y-1.5 text-sm"><li>${UI.skeleton('h-4','w-2/3')}</li><li>${UI.skeleton('h-4','w-1/2')}</li></ul>
        <div class="mt-2 text-[10px] text-dim">Generated from cached market data — not investment advice.</div>
      </div>
    </div>`;

    // Sparkline for index
    if (indexData?.prices?.length) {
      drawSparkline('idxSpark', indexData.prices.map(p => p[1]), idxChange >= 0);
    }
  }

  function renderDashboardData(snaps, indexData, tok) {
    if (!isCurrent(tok)) return;
    const cur = state.currency;
    const rows = Object.values(snaps).filter(s => s.changePct != null && s.price != null);

    // Attach meta
    rows.forEach(r => { const m = STOCK_MAP[r.symbol]; if (m) { r.name = m.name; r.sector = m.sector; } });

    // Gainers / Losers / Active
    const gainers = [...rows].sort((a,b) => b.changePct - a.changePct).slice(0,6);
    const losers  = [...rows].sort((a,b) => a.changePct - b.changePct).slice(0,6);
    const active  = [...rows].filter(r => r.volume).sort((a,b) => (b.volume||0) - (a.volume||0)).slice(0,6);

    const stockRow = (s, showVol = false) => `
      <div class="flex items-center gap-3 py-2 cursor-pointer hover:bg-white/5 rounded-lg px-2 transition" onclick="App.nav('stock','${s.symbol}')">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500/20 to-amber-500/20 flex items-center justify-center text-[10px] font-bold text-teal-300 shrink-0">${(s.symbol||'').replace('.KA','').slice(0,4)}</div>
        <div class="flex-1 min-w-0"><div class="text-sm text-head font-medium truncate">${s.name || s.symbol}</div>
        <div class="text-xs text-dim">${(s.symbol||'').replace('.KA','')}</div></div>
        <div class="text-right"><div class="text-sm text-head">${UI.money(s.price, cur)}</div>
        <div class="text-xs">${showVol ? `<span class="text-dim">${fmtVol(s.volume)}</span>` : UI.pct(s.changePct)}</div></div>
      </div>`;

    setHTML('gainersList', gainers.length ? gainers.map(s => stockRow(s)).join('') : dimNote('No data'));
    setHTML('losersList', losers.length ? losers.map(s => stockRow(s)).join('') : dimNote('No data'));
    setHTML('activeList', active.length ? active.map(s => stockRow(s, true)).join('') : dimNote('No data'));

    // Market breadth
    const priceMap = {};
    rows.forEach(r => { priceMap[r.symbol] = { price: r.price, changePct: r.changePct, volume: r.volume }; });
    const breadth = Sectors.marketBreadth(priceMap);
    setHTML('breadthCard', `${breadth.advances} <span class="text-emerald-400 text-lg">▲</span> / ${breadth.declines} <span class="text-rose-400 text-lg">▼</span>`);
    setHTML('breadthSub', `A/D ratio ${breadth.advanceDeclineRatio} · <span class="${breadth.marketBias==='Bullish'?'text-emerald-400':breadth.marketBias==='Bearish'?'text-rose-400':'text-amber-400'}">${breadth.marketBias}</span>`);

    // Sentiment (derived from breadth + index change)
    const idxChange = getIndexChange(indexData);
    const sentiment = computeSentiment(breadth, idxChange);
    setHTML('sentimentCard', `<span class="${sentiment.cls}">${sentiment.label}</span>`);
    setHTML('sentimentSub', sentiment.sub);

    // Sector bars
    const sectorPerf = Sectors.sectorPerformance(priceMap).filter(s => s.trackedCount > 0).slice(0, 8);
    const maxAbs = Math.max(0.1, ...sectorPerf.map(s => Math.abs(s.avgChange)));
    setHTML('sectorBars', sectorPerf.map(s => {
      const w = Math.min(100, (Math.abs(s.avgChange) / maxAbs) * 100);
      const pos = s.avgChange >= 0;
      return `<div class="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-white/5 rounded px-1" onclick="App.nav('sectors')">
        <div class="w-40 text-xs text-body truncate">${s.sector}</div>
        <div class="flex-1 h-2 bg-white/5 rounded-full overflow-hidden"><div class="h-full ${pos?'bg-emerald-400':'bg-rose-400'} rounded-full" style="width:${w}%"></div></div>
        <div class="w-16 text-right text-xs ${Sectors.sectorColor(s.avgChange)}">${s.avgChange>=0?'+':''}${s.avgChange.toFixed(2)}%</div>
      </div>`;
    }).join('') || dimNote('No sector data'));

    // AI insights
    renderInsights({ breadth, idxChange, sectorPerf, rows, tok });
  }

  function getIndexChange(indexData) {
    if (!indexData) return null;
    const m = indexData.meta || {};
    let p = m.price, pv = m.previousClose;
    if ((!p || p === 0) && indexData.prices?.length) p = indexData.prices[indexData.prices.length-1][1];
    if ((!pv || pv === 0) && indexData.prices?.length >= 2) pv = indexData.prices[indexData.prices.length-2][1];
    return (p && pv) ? ((p - pv) / pv) * 100 : null;
  }

  function computeSentiment(breadth, idxChange) {
    let score = 0;
    if (breadth.marketBias === 'Bullish') score += 2;
    else if (breadth.marketBias === 'Bearish') score -= 2;
    if (idxChange != null) { if (idxChange > 1) score += 2; else if (idxChange > 0) score += 1; else if (idxChange < -1) score -= 2; else score -= 1; }
    if (breadth.advanceDeclineRatio > 0.65) score += 1;
    else if (breadth.advanceDeclineRatio < 0.35) score -= 1;
    let label, cls, sub;
    if (score >= 3) { label = 'Bullish'; cls = 'text-emerald-400'; sub = 'Broad-based buying interest'; }
    else if (score >= 1) { label = 'Mildly Bullish'; cls = 'text-emerald-300'; sub = 'Cautious optimism'; }
    else if (score > -1) { label = 'Neutral'; cls = 'text-amber-400'; sub = 'Market lacks direction'; }
    else if (score > -3) { label = 'Mildly Bearish'; cls = 'text-orange-400'; sub = 'Selling pressure building'; }
    else { label = 'Bearish'; cls = 'text-rose-400'; sub = 'Broad-based weakness'; }
    return { label, cls, sub };
  }

  /* ---------------- AI Insights ---------------- */
  let lastInsightCtx = null;
  async function renderInsights(ctx) {
    if (ctx) lastInsightCtx = ctx;
    const c = lastInsightCtx;
    const list = document.getElementById('aiInsightsList');
    if (!list || !c) return;
    const bullets = [];

    // Index technical read
    try {
      const idx = await API.kse100Index('1y');
      const prices = idx.prices.map(p => p[1]);
      if (prices.length > 50) {
        const ind = Indicators.analyze(prices, idx.total_volumes.map(v => v[1]));
        const rec = Recommend.recommend(ind, null, null);
        bullets.push(`<b>KSE-100</b> is trading ${ind.maTrend === 'up' ? 'above' : 'below'} its 50-day EMA with RSI ${ind.rsi?.toFixed(0) ?? '—'} and ${ind.macd.momentum} MACD momentum — technical bias: <b>${rec.rating}</b>.`);
      }
    } catch {}

    if (c.breadth) {
      const b = c.breadth;
      bullets.push(`Market breadth: <b>${b.advances}</b> advancing vs <b>${b.declines}</b> declining (A/D ${b.advanceDeclineRatio}) — ${b.marketBias === 'Bullish' ? 'broad participation supports the move up.' : b.marketBias === 'Bearish' ? 'widespread selling signals risk-off.' : 'mixed breadth; no clear conviction.'}`);
      if (b.upDownVolumeRatio != null) {
        bullets.push(`Up/down volume ratio is <b>${b.upDownVolumeRatio}</b> — ${b.upDownVolumeRatio > 0.6 ? 'volume favors buyers.' : b.upDownVolumeRatio < 0.4 ? 'volume favors sellers.' : 'volume is evenly split.'}`);
      }
    }

    if (c.idxChange != null) {
      bullets.push(`KSE-100 is ${c.idxChange >= 0 ? 'up' : 'down'} <b>${Math.abs(c.idxChange).toFixed(2)}%</b> today${Math.abs(c.idxChange) > 1.5 ? ' — an outsized move; expect elevated intraday volatility.' : '.'}`);
    }

    if (Array.isArray(c.sectorPerf) && c.sectorPerf.length) {
      const best = c.sectorPerf[0];
      const worst = c.sectorPerf[c.sectorPerf.length - 1];
      if (best && worst && best.sector !== worst.sector) {
        bullets.push(`Sector rotation: <b>${best.sector}</b> leads (${best.avgChange>=0?'+':''}${best.avgChange.toFixed(2)}%) while <b>${worst.sector}</b> lags (${worst.avgChange>=0?'+':''}${worst.avgChange.toFixed(2)}%).`);
      }
    }

    if (Array.isArray(c.rows) && c.rows.length) {
      const up = c.rows.filter(x => (x.changePct ?? 0) > 0).length;
      bullets.push(`Of ${c.rows.length} tracked KSE stocks, <b>${up}</b> are green — ${up / c.rows.length > 0.6 ? 'strong intraday momentum.' : up / c.rows.length < 0.4 ? 'weak intraday tone.' : 'mixed session.'}`);
    }

    const list2 = document.getElementById('aiInsightsList');
    if (!list2) return;
    list2.innerHTML = bullets.length
      ? bullets.map(b => `<li class="flex gap-2"><span class="text-amber-400">•</span><span>${b}</span></li>`).join('')
      : '<li class="text-xs text-dim">Insights unavailable — try Regenerate in a moment.</li>';
  }
  function regenInsights() {
    const list = document.getElementById('aiInsightsList');
    if (list) list.innerHTML = `<li>${UI.skeleton('h-4','w-2/3')}</li><li>${UI.skeleton('h-4','w-1/2')}</li>`;
    renderInsights();
  }

  /* ---------------- Watchlist ---------------- */
  async function renderWatchlist() {
    const tok = renderSeq;
    const cur = state.currency;
    viewEl().innerHTML = `<div class="space-y-3">${UI.skeletonCard(2)}${UI.skeletonCard(8)}</div>`;
    try {
      const snaps = await API.snapshots(state.watchlist);
      state.snapshotCache = { ...state.snapshotCache, ...snaps };
      if (!isCurrent(tok)) return;

      const ordered = state.watchlist.map(sym => snaps[sym]).filter(Boolean);
      ordered.forEach(r => { const m = STOCK_MAP[r.symbol]; if (m) { r.name = m.name; r.sector = m.sector; } });

      const head = `
        <div class="flex items-center justify-between flex-wrap gap-2">
          <h2 class="font-display text-xl font-bold text-head">Watchlist</h2>
          <div class="text-xs text-dim">${state.watchlist.length} stocks · indicators load per stock · add via search ↗</div>
        </div>`;

      const rows = ordered.map(c => `
        <div class="glass glass-hover p-4" id="wl-${cssId(c.symbol)}">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500/20 to-amber-500/20 flex items-center justify-center text-[11px] font-bold text-teal-300 shrink-0 cursor-pointer" onclick="App.nav('stock','${c.symbol}')">${c.symbol.replace('.KA','').slice(0,4)}</div>
            <div class="min-w-[120px] cursor-pointer" onclick="App.nav('stock','${c.symbol}')">
              <div class="text-head font-semibold text-sm truncate">${c.name || c.symbol}</div>
              <div class="text-xs text-dim">${c.symbol.replace('.KA','')} · ${c.sector || ''}</div>
            </div>
            <div class="min-w-[90px]"><div class="text-head text-sm font-medium">${UI.money(c.price, cur)}</div><div class="text-[10px] text-dim">Price</div></div>
            <div class="min-w-[70px]"><div class="text-sm">${UI.pct(c.changePct)}</div><div class="text-[10px] text-dim">Today</div></div>
            <div class="min-w-[80px] hidden sm:block"><div class="text-head text-sm">${fmtVol(c.volume)}</div><div class="text-[10px] text-dim">Volume</div></div>
            <div class="flex-1"></div>
            <div id="ind-${cssId(c.symbol)}" class="flex items-center gap-3 flex-wrap text-xs">
              <div class="skeleton h-4 w-40"></div>
            </div>
            <button onclick="App.removeStock('${c.symbol}')" title="Remove" class="text-dim hover:text-rose-400 transition px-1 text-lg leading-none">×</button>
          </div>
        </div>`).join('');

      viewEl().innerHTML = `<div class="fade-in space-y-3">${head}${rows || dimNote('Watchlist empty — add stocks via search.')}</div>`;

      // Load indicators sequentially
      for (const c of ordered) {
        if (!isCurrent(tok)) return;
        await loadWatchlistIndicators(c, cur);
      }
    } catch (e) {
      if (!isCurrent(tok)) return;
      viewEl().innerHTML = UI.errorCard('Failed to load watchlist.', "App.nav('watchlist')");
    }
  }

  async function loadWatchlistIndicators(c, cur) {
    const el = document.getElementById(`ind-${cssId(c.symbol)}`);
    if (!el) return;
    try {
      const chart = await API.chartForAnalysis(c.symbol, IND_DAYS);
      const prices = chart.prices.map(p => p[1]);
      const vols = chart.total_volumes.map(v => v[1]);
      const ind = Indicators.analyze(prices, vols);
      const meta = STOCK_MAP[c.symbol] || null;
      const sectorCtx = getSectorContext(c.symbol);
      const rec = Recommend.recommend(ind, meta, sectorCtx);
      state.recs[c.symbol] = { rec, name: c.name || c.symbol, sym: c.symbol.replace('.KA','') };
      const el2 = document.getElementById(`ind-${cssId(c.symbol)}`);
      if (!el2) return;
      const macdCls = ind.macd.momentum === 'bullish' ? 'text-emerald-400' : 'text-rose-400';
      el2.innerHTML = `
        <div><span class="text-dim">RSI</span> <span class="${ind.rsi > 70 ? 'text-rose-400' : ind.rsi < 30 ? 'text-emerald-400' : 'text-head'}">${ind.rsi?.toFixed(0) ?? '—'}</span></div>
        <div><span class="text-dim">MACD</span> <span class="${macdCls}">${ind.macd.cross !== 'none' ? ind.macd.cross : ind.macd.momentum}</span></div>
        <div><span class="text-dim">Trend</span> <span class="${ind.maTrend === 'up' ? 'text-emerald-400' : 'text-rose-400'}">${ind.maTrend === 'up' ? '↑ EMA50' : '↓ EMA50'}</span></div>
        <div class="hidden lg:block"><span class="text-dim">S/R</span> <span class="text-head">${UI.money(ind.support, cur)} / ${UI.money(ind.resistance, cur)}</span></div>
        <button onclick="App.showWhy('${c.symbol}')" title="Why this rating?" class="cursor-pointer">${UI.ratingBadge(rec.rating, true)}</button>`;
    } catch {
      const el2 = document.getElementById(`ind-${cssId(c.symbol)}`);
      if (el2) el2.innerHTML = `<button onclick="App.retryIndicators('${c.symbol}')" class="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2">indicators queued — tap to retry</button>`;
    }
  }

  async function retryIndicators(symbol) {
    const el = document.getElementById(`ind-${cssId(symbol)}`);
    if (!el) return;
    el.innerHTML = `<div class="skeleton h-4 w-40"></div>`;
    const c = state.snapshotCache[symbol] || { symbol, name: STOCK_MAP[symbol]?.name };
    await loadWatchlistIndicators(c, state.currency);
  }

  function getSectorContext(symbol) {
    const meta = STOCK_MAP[symbol];
    if (!meta) return null;
    // Build price map from cached snapshots
    const priceMap = {};
    Object.values(state.snapshotCache).forEach(s => {
      if (s.changePct != null) priceMap[s.symbol] = { price: s.price, changePct: s.changePct, volume: s.volume };
    });
    const perf = Sectors.sectorPerformance(priceMap).find(p => p.sector === meta.sector);
    return perf ? { sectorAvgChange: perf.avgChange } : null;
  }

  function removeStock(symbol) {
    state.watchlist = state.watchlist.filter(s => s !== symbol);
    saveWatchlist();
    document.getElementById(`wl-${cssId(symbol)}`)?.remove();
    UI.toast('Removed from watchlist');
  }

  function addStock(symbol, name) {
    if (!state.watchlist.includes(symbol)) {
      state.watchlist.push(symbol);
      saveWatchlist();
      UI.toast(`${name || symbol} added to watchlist`);
    } else UI.toast(`${name || symbol} already in watchlist`);
    $('#searchResults').classList.add('hidden');
    $('#searchInput').value = '';
    if (state.view === 'watchlist') renderWatchlist();
  }

  /* ---------------- Sectors ---------------- */
  async function renderSectors() {
    const tok = renderSeq;
    viewEl().innerHTML = `<div class="space-y-3">${UI.skeletonCard(2)}${UI.skeletonCard(10)}</div>`;
    try {
      // Snapshot all KSE-100 stocks for full sector picture
      const allSyms = KSE100_STOCKS.map(s => s.symbol);
      const snaps = await API.allSnapshots(allSyms, 4);
      state.snapshotCache = { ...state.snapshotCache, ...snaps };
      if (!isCurrent(tok)) return;

      const priceMap = {};
      Object.values(snaps).forEach(s => {
        if (s.changePct != null) priceMap[s.symbol] = { price: s.price, changePct: s.changePct, volume: s.volume };
      });
      const perf = Sectors.sectorPerformance(priceMap);
      const grouped = Sectors.groupBySector(KSE100_STOCKS);

      const cards = perf.map(sec => {
        const stocks = grouped[sec.sector] || [];
        const stockRows = stocks.map(st => {
          const snap = snaps[st.symbol];
          const change = snap?.changePct;
          return `<div class="flex items-center justify-between py-1.5 cursor-pointer hover:bg-white/5 rounded px-2 transition" onclick="App.nav('stock','${st.symbol}')">
            <div class="text-sm text-body truncate flex-1">${st.name}</div>
            <div class="text-sm text-head w-20 text-right">${snap?.price != null ? UI.money(snap.price) : '—'}</div>
            <div class="text-sm w-16 text-right">${change != null ? UI.pct(change) : '<span class="text-dim">—</span>'}</div>
          </div>`;
        }).join('');
        return `
        <div class="glass p-5">
          <div class="flex items-center justify-between mb-2 cursor-pointer" onclick="App.toggleSector('${cssId(sec.sector)}')">
            <div class="font-display font-semibold text-head">${sec.sector}</div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-dim">${sec.upCount}▲ ${sec.downCount}▼</span>
              <span class="text-sm font-bold ${Sectors.sectorColor(sec.avgChange)}">${sec.avgChange>=0?'+':''}${sec.avgChange.toFixed(2)}%</span>
              <span class="text-dim text-xs" id="secArrow-${cssId(sec.sector)}">▼</span>
            </div>
          </div>
          <div id="secBody-${cssId(sec.sector)}" class="hidden border-t border-white/5 pt-2">${stockRows}</div>
        </div>`;
      }).join('');

      viewEl().innerHTML = `
        <div class="fade-in space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h2 class="font-display text-xl font-bold text-head">Sector Analysis</h2>
            <div class="text-xs text-dim">${perf.length} sectors · ${KSE100_STOCKS.length} stocks · tap a sector to expand</div>
          </div>
          ${cards}
        </div>`;
    } catch (e) {
      if (!isCurrent(tok)) return;
      viewEl().innerHTML = UI.errorCard('Failed to load sector data.', "App.nav('sectors')");
    }
  }

  function toggleSector(secId) {
    const body = document.getElementById(`secBody-${secId}`);
    const arrow = document.getElementById(`secArrow-${secId}`);
    if (!body) return;
    body.classList.toggle('hidden');
    if (arrow) arrow.textContent = body.classList.contains('hidden') ? '▼' : '▲';
  }

  /* ---------------- Stock Detail ---------------- */
  async function renderStock(symbol) {
    const tok = renderSeq;
    const cur = state.currency;
    const isIndex = symbol === '^KSE';
    const meta = STOCK_MAP[symbol] || null;
    viewEl().innerHTML = `<div class="space-y-4">${UI.skeletonCard(3)}${UI.skeletonCard(6)}</div>`;
    try {
      const [displayChart, analysisChart] = await Promise.all([
        API.chartForDisplay(symbol, state.range),
        API.chartForAnalysis(symbol, IND_DAYS)
      ]);
      if (!isCurrent(tok)) return;

      const m = analysisChart.meta || {};
      const prices = analysisChart.prices.map(p => p[1]);
      const vols = analysisChart.total_volumes.map(v => v[1]);
      const ind = Indicators.analyze(prices, vols);
      const sectorCtx = getSectorContext(symbol);
      const rec = Recommend.recommend(ind, meta, sectorCtx);
      state.recs[symbol] = { rec, name: m.name || symbol, sym: symbol.replace('.KA','') };

      let price = m.price;
      let prevClose = m.previousClose;
      if ((!price || price === 0) && prices.length) price = prices[prices.length - 1];
      if ((!prevClose || prevClose === 0) && prices.length >= 2) prevClose = prices[prices.length - 2];
      const changePct = (price && prevClose) ? ((price - prevClose) / prevClose) * 100 : null;
      const inWatch = state.watchlist.includes(symbol);

      const macdCls = ind.macd.momentum === 'bullish' ? 'text-emerald-400' : 'text-rose-400';

      viewEl().innerHTML = `
      <div class="fade-in space-y-4">
        <!-- Header -->
        <div class="glass p-5">
          <div class="flex items-start justify-between flex-wrap gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500/25 to-amber-500/25 flex items-center justify-center text-sm font-bold text-teal-300">${isIndex ? 'KSE' : symbol.replace('.KA','').slice(0,4)}</div>
              <div>
                <div class="font-display text-xl font-bold text-head">${m.name || symbol}</div>
                <div class="text-xs text-dim">${isIndex ? 'KSE-100 Index · PSX' : symbol.replace('.KA','') + ' · ' + (meta?.sector || 'PSX')}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="font-display text-2xl font-bold text-head">${isIndex ? (price?price.toLocaleString('en-US',{maximumFractionDigits:2}):'—') : UI.money(price, cur)}</div>
              <div class="text-sm">${UI.pct(changePct)}</div>
            </div>
            ${isIndex ? '' : `<button onclick="App.toggleWatch('${symbol}')" class="px-4 py-2 rounded-lg text-sm ${inWatch ? 'bg-rose-500/10 text-rose-300 border border-rose-500/25' : 'bg-teal-500/15 text-teal-300 border border-teal-500/30'} hover:opacity-80 transition font-medium">${inWatch ? '− Remove' : '+ Watchlist'}</button>`}
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-white/5">
            <div><div class="text-[10px] text-dim uppercase">52W High</div><div class="text-sm text-head">${m.high52w ? UI.money(m.high52w, cur) : '—'}</div></div>
            <div><div class="text-[10px] text-dim uppercase">52W Low</div><div class="text-sm text-head">${m.low52w ? UI.money(m.low52w, cur) : '—'}</div></div>
            ${isIndex ? '' : `<div><div class="text-[10px] text-dim uppercase">Market Cap</div><div class="text-sm text-head">${meta?.marketCap ? '₨' + meta.marketCap + 'B' : '—'}</div></div>
            <div><div class="text-[10px] text-dim uppercase">P/E Ratio</div><div class="text-sm text-head">${meta?.peRatio != null ? meta.peRatio.toFixed(1) + 'x' : '—'}</div></div>`}
          </div>
        </div>

        <!-- Chart -->
        <div class="glass p-5">
          <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div class="font-display font-semibold text-head">Price Chart</div>
            <div class="flex gap-1.5">
              ${['1mo','3mo','6mo','1y','2y'].map(r => `<button onclick="App.setRange('${symbol}','${r}')" class="px-2.5 py-1 rounded-lg text-xs border ${state.range===r?'tab-active':'border-transparent text-body hover:text-teal-300'} transition">${r.toUpperCase()}</button>`).join('')}
            </div>
          </div>
          <div style="height:320px"><canvas id="stockChart"></canvas></div>
        </div>

        <!-- AI Card + Indicators -->
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="glass p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="font-display font-semibold text-head">🧠 AI Rating</div>
              ${UI.ratingBadge(rec.rating)}
            </div>
            <div class="flex gap-4 mb-3 text-sm flex-wrap">
              <div><span class="text-dim">Confidence</span> <span class="text-head font-medium">${rec.confidence}%</span></div>
              <div><span class="text-dim">Risk</span> <span class="text-head font-medium">${rec.risk}</span></div>
              <div><span class="text-dim">Score</span> <span class="text-head font-medium">${rec.score}</span></div>
            </div>
            <div class="text-[10px] text-dim uppercase tracking-wider mb-1.5">Analysis</div>
            <ul class="space-y-1.5 text-sm mb-4">${rec.reasons.map(r => `<li class="flex gap-2"><span class="text-amber-400">•</span><span>${r}</span></li>`).join('')}</ul>
            <div class="text-xs space-y-1.5 border-t border-white/5 pt-3">
              <div><span class="text-dim">Entry:</span> ${rec.entry}</div>
              <div><span class="text-dim">Exit:</span> ${rec.exit}</div>
              <div><span class="text-dim">Target:</span> ${UI.money(rec.target, cur)} · <span class="text-dim">Stop:</span> ${UI.money(rec.stopLoss, cur)}</div>
            </div>
            <div class="mt-3 text-[10px] text-dim">Rule-based technical analysis — not investment advice.</div>
          </div>

          <div class="glass p-5">
            <div class="font-display font-semibold text-head mb-3">Technical Indicators</div>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">RSI (14)</div><div class="text-lg font-bold ${ind.rsi>70?'text-rose-400':ind.rsi<30?'text-emerald-400':'text-head'}">${ind.rsi?.toFixed(1) ?? '—'}</div><div class="text-[10px] text-dim">${ind.rsi>70?'Overbought':ind.rsi<30?'Oversold':'Neutral'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">MACD</div><div class="text-lg font-bold ${macdCls}">${ind.macd.momentum}</div><div class="text-[10px] text-dim">${ind.macd.cross !== 'none' ? ind.macd.cross + ' cross' : 'no recent cross'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">EMA 20 / 50</div><div class="text-sm font-bold text-head">${UI.money(ind.ema20,cur)}</div><div class="text-[10px] text-dim">50: ${UI.money(ind.ema50,cur)}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">EMA 200</div><div class="text-sm font-bold text-head">${UI.money(ind.ema200,cur)}</div><div class="text-[10px] ${ind.maTrend==='up'?'text-emerald-400':'text-rose-400'}">${ind.maTrend==='up'?'↑ uptrend':'↓ downtrend'}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">Support</div><div class="text-sm font-bold text-emerald-400">${UI.money(ind.support,cur)}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">Resistance</div><div class="text-sm font-bold text-rose-400">${UI.money(ind.resistance,cur)}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">Bollinger</div><div class="text-[11px] text-head">${UI.money(ind.bbLower,cur)} – ${UI.money(ind.bbUpper,cur)}</div></div>
              <div class="p-3 rounded-lg bg-white/[0.03]"><div class="text-[10px] text-dim uppercase">7d / 30d Mom</div><div class="text-[11px]">${UI.pct(ind.mom7d)} / ${UI.pct(ind.mom30d)}</div></div>
            </div>
          </div>
        </div>
      </div>`;

      drawChart(displayChart, changePct >= 0);
    } catch (e) {
      if (!isCurrent(tok)) return;
      viewEl().innerHTML = UI.errorCard('Failed to load stock data for ' + symbol + '.', `App.nav('stock','${symbol}')`);
    }
  }

  function setRange(symbol, range) {
    state.range = range;
    renderStock(symbol);
  }

  function toggleWatch(symbol) {
    if (state.watchlist.includes(symbol)) removeStock(symbol);
    else { state.watchlist.push(symbol); saveWatchlist(); UI.toast('Added to watchlist'); }
    renderStock(symbol);
  }

  function drawChart(chartData, isUp) {
    const canvas = document.getElementById('stockChart');
    if (!canvas) return;
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    const prices = chartData.prices;
    const labels = prices.map(p => new Date(p[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const data = prices.map(p => p[1]);
    const color = isUp ? '#2dd4bf' : '#fb7185';
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0, isUp ? 'rgba(45,212,191,0.25)' : 'rgba(251,113,133,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    state.chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data, borderColor: color, backgroundColor: grad, borderWidth: 2, fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => UI.money(c.parsed.y, state.currency) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: (v) => UI.money(v, state.currency) } }
        }
      }
    });
  }

  function drawSparkline(canvasId, data, isUp) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext('2d');
    const color = isUp ? '#2dd4bf' : '#fb7185';
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  /* ---------------- "Why" Modal ---------------- */
  function showWhy(symbol) {
    const entry = state.recs[symbol];
    if (!entry) { UI.toast('Analysis still loading — try again shortly'); return; }
    const { rec, name, sym } = entry;
    closeWhy();
    const wrap = document.createElement('div');
    wrap.id = 'whyModal';
    wrap.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4';
    wrap.innerHTML = `
      <div class="absolute inset-0 bg-black/60" onclick="App.closeWhy()"></div>
      <div class="glass relative max-w-md w-full p-5 fade-in" style="background:rgba(10,17,25,.95)">
        <div class="flex items-center justify-between mb-3">
          <div class="font-display font-semibold text-head">${name} <span class="text-dim text-xs">${sym}</span></div>
          <div class="flex items-center gap-2">${UI.ratingBadge(rec.rating)}<button onclick="App.closeWhy()" class="text-dim hover:text-rose-400 text-xl leading-none px-1">×</button></div>
        </div>
        <div class="flex gap-4 mb-3 text-sm flex-wrap">
          <div><span class="text-dim">Confidence</span> <span class="text-head font-medium">${rec.confidence}%</span></div>
          <div><span class="text-dim">Risk</span> <span class="text-head font-medium">${rec.risk}</span></div>
          <div><span class="text-dim">Score</span> <span class="text-head font-medium">${rec.score}</span></div>
        </div>
        <div class="text-[10px] text-dim uppercase tracking-wider mb-1.5">Why ${rec.rating}?</div>
        <ul class="space-y-1.5 text-sm mb-4">${rec.reasons.map(r => `<li class="flex gap-2"><span class="text-amber-400">•</span><span>${r}</span></li>`).join('')}</ul>
        <div class="text-xs space-y-1.5">
          <div><span class="text-dim">Entry:</span> ${rec.entry}</div>
          <div><span class="text-dim">Exit:</span> ${rec.exit}</div>
        </div>
        <div class="mt-3 text-[10px] text-dim">Rule-based technical analysis (RSI, MACD, EMAs, momentum, volume) — not investment advice.</div>
      </div>`;
    document.body.appendChild(wrap);
  }
  function closeWhy() { document.getElementById('whyModal')?.remove(); }

  /* ---------------- Alerts ---------------- */
  function renderAlerts() {
    newRender();
    const cur = state.currency;
    const alertRows = alertsStore.alerts.length ? alertsStore.alerts.map((a, i) => `
      <div class="glass p-4 flex items-center gap-3 flex-wrap">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500/20 to-amber-500/20 flex items-center justify-center text-[11px] font-bold text-teal-300">${a.symbol.replace('.KA','').slice(0,4)}</div>
        <div class="flex-1 min-w-[120px]">
          <div class="text-head font-medium text-sm">${STOCK_MAP[a.symbol]?.name || a.symbol}</div>
          <div class="text-xs text-dim">Alert when price ${a.direction === 'above' ? '≥' : '≤'} ${UI.money(a.price, cur)}</div>
        </div>
        <span class="text-xs px-2 py-1 rounded-lg ${a.triggered ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}">${a.triggered ? 'Triggered' : 'Active'}</span>
        <button onclick="App.removeAlert(${i})" class="text-dim hover:text-rose-400 text-lg leading-none px-1">×</button>
      </div>`).join('') : dimNote('No alerts yet. Set one below.');

    const histRows = alertsStore.history.length ? alertsStore.history.slice(-10).reverse().map(h => `
      <div class="flex items-center justify-between py-2 text-sm border-b border-white/5">
        <span class="text-body">${STOCK_MAP[h.symbol]?.name || h.symbol} ${h.direction === 'above' ? '≥' : '≤'} ${UI.money(h.price, cur)}</span>
        <span class="text-xs text-dim">${new Date(h.time).toLocaleString()}</span>
      </div>`).join('') : dimNote('No triggered alerts yet.');

    const options = KSE100_STOCKS.map(s => `<option value="${s.symbol}" class="bg-slate-900">${s.name} (${s.symbol.replace('.KA','')})</option>`).join('');

    viewEl().innerHTML = `
    <div class="fade-in space-y-4">
      <h2 class="font-display text-xl font-bold text-head">Price Alerts</h2>
      <div class="glass p-5">
        <div class="font-display font-semibold text-head mb-3">Create Alert</div>
        <div class="grid gap-3 sm:grid-cols-4">
          <select id="alSymbol" class="glass !rounded-lg px-3 py-2 text-sm bg-transparent text-head outline-none sm:col-span-2">${options}</select>
          <select id="alDir" class="glass !rounded-lg px-3 py-2 text-sm bg-transparent text-head outline-none">
            <option value="above" class="bg-slate-900">Rises above</option>
            <option value="below" class="bg-slate-900">Falls below</option>
          </select>
          <input id="alPrice" type="number" step="any" min="0" placeholder="Price (PKR)" class="glass !rounded-lg px-3 py-2 text-sm bg-transparent text-head placeholder:text-dim outline-none">
        </div>
        <button onclick="App.addAlert()" class="mt-3 px-4 py-2 rounded-lg text-sm bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 transition font-medium">+ Add Alert</button>
        <div class="mt-2 text-[10px] text-dim">Alerts are checked periodically while the app is open (browser-based, best-effort).</div>
      </div>
      <div class="glass p-5">
        <div class="font-display font-semibold text-head mb-3">Active Alerts</div>
        <div class="space-y-2">${alertRows}</div>
      </div>
      <div class="glass p-5">
        <div class="font-display font-semibold text-head mb-3">History</div>
        ${histRows}
      </div>
    </div>`;
  }

  function addAlert() {
    const symbol = $('#alSymbol').value;
    const direction = $('#alDir').value;
    const price = parseFloat($('#alPrice').value);
    if (!symbol || !price || price <= 0) { UI.toast('Enter a valid price'); return; }
    alertsStore.alerts.push({ symbol, direction, price, triggered: false, created: Date.now() });
    saveAlerts();
    UI.toast('Alert created');
    renderAlerts();
  }
  function removeAlert(i) {
    alertsStore.alerts.splice(i, 1);
    saveAlerts();
    renderAlerts();
  }

  async function checkAlerts() {
    const active = alertsStore.alerts.filter(a => !a.triggered);
    if (!active.length) return;
    const symbols = [...new Set(active.map(a => a.symbol))];
    try {
      const snaps = await API.snapshots(symbols);
      let changed = false;
      for (const a of active) {
        const s = snaps[a.symbol];
        if (!s || s.price == null) continue;
        const hit = (a.direction === 'above' && s.price >= a.price) || (a.direction === 'below' && s.price <= a.price);
        if (hit) {
          a.triggered = true;
          changed = true;
          alertsStore.history.push({ symbol: a.symbol, direction: a.direction, price: a.price, time: Date.now(), hitPrice: s.price });
          UI.toast(`🔔 ${STOCK_MAP[a.symbol]?.name || a.symbol} ${a.direction === 'above' ? 'rose above' : 'fell below'} ${UI.money(a.price)}`);
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('StockSage Alert', { body: `${a.symbol.replace('.KA','')} ${a.direction} ${a.price} PKR (now ${s.price.toFixed(2)})` });
          }
        }
      }
      if (changed) { saveAlerts(); if (state.view === 'alerts') renderAlerts(); }
    } catch {}
  }

  /* ---------------- Settings ---------------- */
  function renderSettings() {
    newRender();
    viewEl().innerHTML = `
    <div class="fade-in space-y-4 max-w-2xl">
      <h2 class="font-display text-xl font-bold text-head">Settings</h2>
      <div class="glass p-5 space-y-5">
        <div>
          <div class="text-sm text-head font-medium mb-2">Theme</div>
          <div class="flex gap-2">
            <button id="themeDark" class="px-4 py-2 rounded-lg text-sm border ${state.theme==='dark'?'tab-active':'border-white/10 text-body'} transition">🌙 Dark</button>
            <button id="themeLight" class="px-4 py-2 rounded-lg text-sm border ${state.theme==='light'?'tab-active':'border-white/10 text-body'} transition">☀️ Light</button>
          </div>
        </div>
        <div>
          <div class="text-sm text-head font-medium mb-2">Currency</div>
          <div class="text-xs text-dim">PKR (Pakistani Rupee) — all PSX prices are quoted in PKR.</div>
        </div>
        <div>
          <div class="text-sm text-head font-medium mb-2">Notifications</div>
          <button id="notifBtn" class="px-4 py-2 rounded-lg text-sm bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 transition">Enable browser notifications</button>
          <div class="text-xs text-dim mt-1">For price alerts (best-effort while app is open).</div>
        </div>
        <div>
          <div class="text-sm text-head font-medium mb-2">Watchlist</div>
          <div class="text-xs text-dim mb-2">${state.watchlist.length} stocks tracked</div>
          <button id="resetWl" class="px-4 py-2 rounded-lg text-sm bg-rose-500/10 text-rose-300 border border-rose-500/25 hover:bg-rose-500/20 transition">Reset to defaults</button>
        </div>
        <div>
          <div class="text-sm text-head font-medium mb-2">Cache</div>
          <button id="clearCache" class="px-4 py-2 rounded-lg text-sm bg-white/5 text-body border border-white/10 hover:bg-white/10 transition">Clear cached data</button>
        </div>
        <div class="text-[11px] text-dim border-t border-white/10 pt-4">
          StockSage AI v1.0 · Data: Yahoo Finance (PSX / Karachi, cached) · KSE-100 constituents hardcoded · Analysis is rule-based, not investment advice.
        </div>
      </div>
    </div>`;
    $('#themeDark').addEventListener('click', () => { state.theme='dark'; localStorage.setItem('ss_theme','dark'); applyTheme(); renderSettings(); });
    $('#themeLight').addEventListener('click', () => { state.theme='light'; localStorage.setItem('ss_theme','light'); applyTheme(); renderSettings(); });
    $('#resetWl').addEventListener('click', () => { state.watchlist = DEFAULT_WATCHLIST.slice(); saveWatchlist(); UI.toast('Watchlist reset'); renderSettings(); });
    $('#clearCache').addEventListener('click', () => {
      Object.keys(localStorage).filter(k => k.startsWith('ss_cache_')).forEach(k => localStorage.removeItem(k));
      UI.toast('Cache cleared');
    });
    $('#notifBtn').addEventListener('click', async () => {
      if (!('Notification' in window)) { UI.toast('Notifications not supported'); return; }
      const perm = await Notification.requestPermission();
      UI.toast(perm === 'granted' ? 'Notifications enabled' : 'Notifications denied');
    });
  }

  /* ---------------- Search ---------------- */
  function initSearch() {
    const input = $('#searchInput');
    const results = $('#searchResults');
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { results.classList.add('hidden'); return; }
      t = setTimeout(() => {
        const matches = KSE100_STOCKS.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.symbol.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q)
        ).slice(0, 10);
        results.innerHTML = matches.length ? matches.map(s => `
          <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 cursor-pointer transition" onclick="App.nav('stock','${s.symbol}')">
            <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500/20 to-amber-500/20 flex items-center justify-center text-[9px] font-bold text-teal-300">${s.symbol.replace('.KA','').slice(0,4)}</div>
            <div class="flex-1 min-w-0"><div class="text-sm text-head truncate">${s.name}</div><div class="text-xs text-dim">${s.symbol.replace('.KA','')} · ${s.sector}</div></div>
            <button onclick="event.stopPropagation();App.addStock('${s.symbol}','${s.name.replace(/'/g,'')}')" class="text-teal-400 hover:text-teal-300 text-lg px-1" title="Add to watchlist">+</button>
          </div>`).join('')
          : `<div class="p-3 text-sm text-dim">No results</div>`;
        results.classList.remove('hidden');
      }, 180);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#searchInput') && !e.target.closest('#searchResults'))
        results.classList.add('hidden');
    });
  }

  /* ---------------- Helpers ---------------- */
  function cssId(symbol) { return (symbol || '').replace(/[^a-zA-Z0-9]/g, '_'); }
  function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
  function dimNote(msg) { return `<div class="text-xs text-dim py-4">${msg}</div>`; }
  function fmtVol(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1e9) return (v/1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v/1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v/1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  /* ---------------- Init ---------------- */
  function init() {
    applyTheme();
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.addEventListener('click', () => nav(b.dataset.nav)));
    initSearch();
    UI.updateTradingClock();
    setInterval(UI.updateTradingClock, 30_000);
    nav('dashboard');
    setTimeout(checkAlerts, 10000);
    setInterval(checkAlerts, 90_000);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    nav, addStock, removeStock, toggleWatch, retryIndicators, showWhy, closeWhy,
    setRange, toggleSector, regenInsights, addAlert, removeAlert
  };
})();