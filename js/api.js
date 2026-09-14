/**
 * api.js — Data layer for StockSage AI (PSX — Pakistan Stock Exchange).
 * Uses Yahoo Finance v8 chart endpoint (client-side, no key needed).
 * All responses cached in localStorage with per-endpoint TTL.
 *
 * STRATEGY: v8 chart is the ONLY reliable browser endpoint. v7 quote is dead (401).
 * We derive snapshots from v8 chart data with a concurrency pool for speed.
 */
const API = (() => {
  const YH_PRIMARY  = 'https://query1.finance.yahoo.com/v8/finance/chart';
  const YH_FALLBACK = 'https://query2.finance.yahoo.com/v8/finance/chart';

  const CACHE_PREFIX = 'ss_cache_';
  const INTRADAY_TTL   = 120_000; // 2 min for 1D/5D charts
  const LONG_TTL       = 600_000; // 10 min for daily/weekly charts
  const CONCURRENCY     = 8;       // parallel chart requests for snapshot pool

  // ---- PSX market hours (PKT = UTC+5), Mon–Fri ~9:15–16:30 ----
  function isMarketOpen() {
    const pkt = new Date(Date.now() + 5 * 3600_000);
    const day = pkt.getUTCDay();
    if (day === 0 || day === 6) return false; // Sun/Sat
    const mins = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
    return mins >= 9 * 60 + 15 && mins <= 16 * 60 + 30;
  }

  // Snapshots change every minute while trading — but not at all when the
  // market is closed. Cache accordingly (60s open / 6h closed).
  function snapshotTtl() { return isMarketOpen() ? 60_000 : 21_600_000; }

  // Track whether v7 batch was tried and failed — skip it for the rest of the session
  let v7BatchDead = false;

  // ---- Cache helpers ----
  function readCache(key, ttl, allowStale = false) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const { t, d } = JSON.parse(raw);
      if (Date.now() - t < ttl) return d;
      return allowStale ? d : null;
    } catch { return null; }
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) {
      pruneCache();
    }
  }

  function pruneCache() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
  }

  // ---- robustFetch — direct first, one CORS proxy fallback ----
  /**
   * Fetch a URL directly (browser sets real User-Agent automatically).
   * If direct fails, try allorigins.win/get as a LAST RESORT.
   * Returns parsed JSON.
   *
   * IMPORTANT: Do NOT set User-Agent header — browsers FORBID it. The
   * browser sends its own real UA, which Yahoo accepts.
   */
  async function robustFetch(url, { noProxy = false } = {}) {
    // 1. Try direct — browser auto-sends its real User-Agent, Yahoo accepts it
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        return json;
      }
      if (res.status === 429) throw new Error('rate-limited');
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (e.message === 'rate-limited' || noProxy) throw e;
      // fall through to proxy
    }

    // 2. Last resort: shared multi-proxy helper (8s timeout per proxy,
    //    dead proxies remembered for the session — no 20s stalls)
    const text = await proxyFetchText(url);
    return JSON.parse(text);
  }

  // ════════════════════════════════════════
  // PSX OFFICIAL DATA PORTAL (dps.psx.com.pk) — primary source.
  // The exchange itself: no rate limits like Yahoo, always accurate.
  // No CORS headers though, so browser access goes through public proxies
  // (corsproxy.io allows browser-origin requests on the free tier).
  // ════════════════════════════════════════
  const PSX_DPS = 'https://dps.psx.com.pk';

  // ════════════════════════════════════════
  // STATIC DATA BRANCH (primary source) — refreshed every 5 min by a GitHub
  // Action (.github/workflows/psx-data.yml) that fetches dps.psx.com.pk
  // server-side and force-pushes JSON to the `data` branch.
  // raw.githubusercontent.com sends Access-Control-Allow-Origin: * — so the
  // browser reads it directly. No CORS proxies, no Yahoo rate limits.
  // ════════════════════════════════════════
  const STATIC_BASE = 'https://raw.githubusercontent.com/Haziqbaig/psx-ai-assistant/data';
  let staticDead = false; // one hard failure on the core file → skip static for the session

  async function staticJson(file) {
    if (staticDead) throw new Error('static source unavailable');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      // cache-bust on a 5-min grid so CDN caching aligns with the refresh cadence
      const bust = Math.floor(Date.now() / 300_000);
      const res = await fetch(`${STATIC_BASE}/${file}?v=${bust}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (file === 'snapshots.json') staticDead = true; // core file gone → branch not set up
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const CORS_PROXIES = [
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + u,
  ];
  const deadProxies = new Set();

  /** Fetch text through the first working CORS proxy (8s timeout each). */
  async function proxyFetchText(url) {
    let lastErr;
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      if (deadProxies.has(i)) continue;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(CORS_PROXIES[i](url), { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (!text || text.startsWith('error code')) throw new Error('proxy error body');
        return text;
      } catch (e) {
        lastErr = e;
        deadProxies.add(i); // don't waste 8s on this proxy again this session
      }
    }
    throw lastErr || new Error('all proxies failed');
  }

  /**
   * ONE request for the whole market: parse the PSX market-watch table.
   * Returns { 'OGDC.KA': snapshot, ... } keyed with the app's .KA convention.
   */
  async function psxMarketWatch() {
    const cacheKey = 'psx_mw';
    const fresh = readCache(cacheKey, snapshotTtl());
    if (fresh) return fresh;
    // Primary: pre-fetched snapshots from the data branch (server-side, no CORS)
    try {
      const j = await staticJson('snapshots.json');
      if (j?.snapshots && Object.keys(j.snapshots).length) {
        writeCache(cacheKey, j.snapshots);
        return j.snapshots;
      }
    } catch (_) { /* static unavailable — fall back to live proxy scrape */ }
    const html = await proxyFetchText(PSX_DPS + '/market-watch');
    const out = {};
    const rowRe = /<tr><td data-search="([A-Z0-9]+)"[\s\S]*?data-title="([^"]*)"[\s\S]*?<\/tr>/g;
    const ordRe = /data-order="(-?[\d.]+)"/g;
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const sym = m[1], row = m[0];
      const name = m[2].replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');
      const nums = [];
      let o; ordRe.lastIndex = 0;
      while ((o = ordRe.exec(row)) !== null) nums.push(parseFloat(o[1]));
      // column order: ldcp, open, high, low, close(current), change, %change, volume
      if (nums.length < 8) continue;
      const [ldcp, open, high, low, close, change, pct, volume] = nums;
      if (!close) continue;
      out[sym + '.KA'] = {
        symbol: sym + '.KA',
        name: name || sym,
        price: close,
        previousClose: ldcp || null,
        changePct: isFinite(pct) ? pct : (ldcp ? ((close - ldcp) / ldcp) * 100 : null),
        volume: volume || null,
        high52w: null, low52w: null,
        dayHigh: high || null, dayLow: low || null, open: open || null,
        currency: 'PKR', timezone: 'PKT', marketCap: null,
      };
    }
    if (!Object.keys(out).length) throw new Error('market-watch parse failed');
    writeCache(cacheKey, out);
    return out;
  }

  /** PSX intraday index timeseries → chart shape (fallback when Yahoo dies). */
  async function psxIndexChart(indexName = 'KSE100') {
    const cacheKey = 'psx_idx_' + indexName;
    const fresh = readCache(cacheKey, INTRADAY_TTL);
    if (fresh) return fresh;
    let json;
    // Primary: pre-fetched intraday index from the data branch
    try {
      json = (await staticJson('kse100_int.json'))?.data;
    } catch (_) { /* fall back to live proxy fetch */ }
    if (!json?.data?.length) {
      const text = await proxyFetchText(`${PSX_DPS}/timeseries/int/${indexName}`);
      json = JSON.parse(text);
    }
    const rows = (json?.data || []).slice().reverse(); // newest-first → oldest-first
    if (!rows.length) throw new Error('no index data');
    const prices = rows.map(r => [r[0] * 1000, r[1]]);
    const last = prices[prices.length - 1][1];
    const first = prices[0][1];
    const data = {
      prices,
      total_volumes: rows.map(r => [r[0] * 1000, r[2] || 0]),
      candles: null,
      meta: {
        price: last, currency: 'PKR', name: 'KSE-100 Index',
        previousClose: first, exchangeName: 'PSX', timezone: 'PKT', gmtoffset: 18000,
      },
    };
    writeCache(cacheKey, data);
    return data;
  }

  /** Map app symbols to PSX portal symbols: 'OGDC.KA' → 'OGDC', '^KSE' → 'KSE100'. */
  function psxSymbol(symbol) {
    if (symbol === '^KSE' || symbol === 'KSE100') return 'KSE100';
    return symbol.replace(/\.KA$/, '');
  }

  /**
   * PSX official EOD timeseries → chart shape. ~5 years of daily closes
   * ([ts, close, volume, open] newest-first) — plenty for charts + indicators.
   */
  async function psxEodChart(symbol, lookbackDays = 250) {
    const psym = psxSymbol(symbol);
    const cacheKey = 'psx_eod_' + psym;
    let rows = readCache(cacheKey, LONG_TTL);
    if (!rows) {
      // Primary: pre-fetched EOD series from the data branch
      try {
        rows = (await staticJson(`eod/${psym}.json`))?.data?.data;
      } catch (_) { /* fall back to live proxy fetch */ }
      if (!Array.isArray(rows) || !rows.length) {
        const text = await proxyFetchText(`${PSX_DPS}/timeseries/eod/${psym}`);
        const json = JSON.parse(text);
        rows = json?.data;
      }
      if (!Array.isArray(rows) || !rows.length) throw new Error('no PSX eod data for ' + psym);
      writeCache(cacheKey, rows);
    }
    const asc = rows.slice().reverse().slice(-Math.max(lookbackDays, 30));
    const prices = asc.map(r => [r[0] * 1000, r[1]]);
    const last = asc[asc.length - 1];
    const prev = asc[asc.length - 2];
    return {
      prices,
      total_volumes: asc.map(r => [r[0] * 1000, r[2] || 0]),
      candles: asc.map(r => ({ t: r[0] * 1000, o: r[3] ?? r[1], h: Math.max(r[1], r[3] ?? r[1]), l: Math.min(r[1], r[3] ?? r[1]), c: r[1] })),
      meta: {
        price: last[1], currency: 'PKR',
        name: psym === 'KSE100' ? 'KSE-100 Index' : psym,
        previousClose: prev ? prev[1] : null,
        exchangeName: 'PSX', timezone: 'PKT', gmtoffset: 18000,
      },
    };
  }

  // ---- Build v8 chart URL ----
  function chartUrl(symbol, range, interval) {
    const host = YH_PRIMARY; // query1 is most reliable
    return `${host}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  }

  /** Approximate lookback days for a Yahoo range string (for PSX EOD fallback). */
  function rangeToDays(range) {
    return { '1d': 2, '5d': 7, '1mo': 31, '3mo': 92, '6mo': 183, '1y': 365, '2y': 730, '5y': 1825, 'max': 10000 }[range] || 92;
  }

  // ════════════════════════════════════════════
  // FETCH CHART (individual symbol, for detail views & index)
  // ════════════════════════════════════════════

  /**
   * Fetch chart data from Yahoo Finance v8.
   * Returns normalized { prices, total_volumes, candles, meta } or throws.
   */
  async function fetchChart(symbol, range = '3mo', interval = '1d') {
    const cacheKey = `chart_${symbol}_${range}_${interval}`;
    const ttl = (range === '1d' || range === '5d') ? INTRADAY_TTL : LONG_TTL;

    const fresh = readCache(cacheKey, ttl);
    if (fresh) return fresh;

    // Primary: PSX official data via the pre-fetched static branch.
    // Daily-interval charts come from EOD series; Yahoo is only a fallback.
    if (interval === '1d') {
      try {
        const psx = await psxEodChart(symbol, rangeToDays(range));
        writeCache(cacheKey, psx);
        return psx;
      } catch (_) { /* static + proxies unavailable — try Yahoo below */ }
    } else if (symbol === '^KSE' || symbol === 'KSE100') {
      // Intraday index → PSX official intraday timeseries
      try {
        return await psxIndexChart('KSE100');
      } catch (_) { /* fall through to Yahoo */ }
    }

    // Retry once on failure
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = chartUrl(symbol, range, interval);
        const json = await robustFetch(url);

        const result = json?.chart?.result?.[0];
        if (!result) throw new Error('No chart data');

        const meta = result.meta || {};
        const ts = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};
        const adjclose = result.indicators?.adjclose?.[0] || {};

        const opens   = quotes.open || [];
        const highs   = quotes.high || [];
        const lows    = quotes.low || [];
        const closes  = adjclose?.adjclose || quotes.close || [];
        const volumes = quotes.volume || [];

        const prices  = [];
        const vols    = [];
        const candles = [];

        for (let i = 0; i < ts.length; i++) {
          const c = closes[i];
          if (c != null) {
            prices.push([ts[i] * 1000, c]);
            vols.push([ts[i] * 1000, volumes[i] || 0]);
            candles.push({
              t: ts[i] * 1000,
              o: opens[i] ?? c,
              h: highs[i] ?? c,
              l: lows[i] ?? c,
              c: c
            });
          }
        }

        // Fallback: use opens if no closes
        if (!prices.length && ts.length && opens.length) {
          for (let i = 0; i < ts.length; i++) {
            if (opens[i] != null) {
              prices.push([ts[i] * 1000, opens[i]]);
              vols.push([ts[i] * 1000, volumes[i] || 0]);
              candles.push({
                t: ts[i] * 1000,
                o: opens[i],
                h: highs[i] || opens[i],
                l: lows[i] || opens[i],
                c: closes[i] || opens[i]
              });
            }
          }
        }

        const data = {
          prices,
          total_volumes: vols,
          candles,
          meta: {
            price:         meta.regularMarketPrice,
            currency:      meta.currency || 'PKR',
            name:          meta.longName || meta.shortName || symbol,
            previousClose: meta.chartPreviousClose,
            high52w:       meta.fiftyTwoWeekHigh,
            low52w:        meta.fiftyTwoWeekLow,
            exchangeName:  meta.fullExchangeName || meta.exchangeName || 'PSX',
            timezone:      meta.timezone || 'PKT',
            gmtoffset:     meta.gmtoffset || 18000,
            tradingPeriod: meta.currentTradingPeriod || null
          }
        };

        writeCache(cacheKey, data);
        return data;
      } catch (e) {
        // Only retry if not rate-limited and first attempt
        if (attempt < 1 && e.message !== 'rate-limited') {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          // Return stale cache if available
          const stale = readCache(cacheKey, Infinity, true);
          if (stale) return stale;
          // Yahoo dead → PSX official EOD (daily closes; intraday granularity
          // isn't available, but a daily chart beats an error card)
          try {
            const psx = await psxEodChart(symbol, rangeToDays(range));
            writeCache(cacheKey, psx);
            return psx;
          } catch (_) { /* PSX also unavailable */ }
          throw e;
        }
      }
    }
  }

  // ════════════════════════════════════════════
  // SNAPSHOTS — derive price/change from v8 chart
  // ════════════════════════════════════════════

  /**
   * Derive a snapshot from a v8 chart response for range=2d or 5d, interval=1d.
   * v8 meta gives current price + previous close, which gives us change%.
   */
  function chartToSnapshot(symbol, json) {
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    let price     = meta.regularMarketPrice;
    let prevClose = meta.chartPreviousClose;

    // Fallback: derive from last 2 daily candles
    if ((price == null || prevClose == null) && result.timestamp) {
      const quotes = result.indicators?.quote?.[0] || {};
      const adjclose = result.indicators?.adjclose?.[0] || {};
      const closes = adjclose?.adjclose || quotes.close || [];
      if (closes.length >= 2) {
        price     = closes[closes.length - 1];
        prevClose = closes[closes.length - 2];
      } else if (closes.length === 1) {
        price = closes[0];
      }
    }

    let changePct = null;
    if (price != null && prevClose != null && prevClose !== 0) {
      changePct = ((price - prevClose) / Math.abs(prevClose)) * 100;
      // Sanity check — cap absurd changes
      if (Math.abs(changePct) > 40) changePct = null;
    }

    // Volume from last candle
    let volume = null;
    if (result.timestamp) {
      const quotes = result.indicators?.quote?.[0] || {};
      const vols = quotes.volume || [];
      if (vols.length) {
        volume = vols[vols.length - 1];
      }
    }

    return {
      symbol:       symbol,
      name:         meta.longName || meta.shortName || symbol,
      price:        price ?? null,
      previousClose: prevClose ?? null,
      changePct:    changePct,
      volume:       volume ?? null,
      high52w:      meta.fiftyTwoWeekHigh ?? null,
      low52w:       meta.fiftyTwoWeekLow ?? null,
      currency:     meta.currency || 'PKR',
      timezone:     meta.timezone || 'PKT',
      marketCap:    meta.marketCap ?? null,
    };
  }

  /**
   * Fetch snapshots for multiple symbols using v8 chart with a concurrency pool.
   * Uses range=5d interval=1d (gives last 4-5 closes + meta with price/prevClose).
   * @param {string[]} symbols
   * @param {function} [onBatch] - optional callback(partialResult) after each batch completes
   */
  async function v8SnapshotPool(symbols, onBatch, seed = null) {
    const cacheKey = 'v8snap_' + [...symbols].sort().join(',');
    const fresh = readCache(cacheKey, snapshotTtl());
    if (fresh) {
      if (onBatch) onBatch(fresh);
      return fresh;
    }

    const result = {};
    let batchCount = 0;

    // Process in chunks with controlled concurrency
    async function runPool() {
      let idx = 0;
      const workers = [];

      async function worker() {
        while (idx < symbols.length) {
          const sym = symbols[idx++];
          try {
            // noProxy: a failing per-symbol proxy fallback costs ~20s each —
            // far better to fail fast and keep the seed/spark value.
            const url = chartUrl(sym, '5d', '1d');
            const json = await robustFetch(url, { noProxy: true });
            const snap = chartToSnapshot(sym, json);
            result[sym] = snap || seed?.[sym] || { symbol: sym, name: sym, price: null, changePct: null, volume: null };
          } catch (e) {
            result[sym] = seed?.[sym] || { symbol: sym, name: sym, price: null, changePct: null, volume: null, error: e.message };
          }
        }
      }

      // Launch CONCURRENCY workers
      const workerPromises = [];
      for (let i = 0; i < CONCURRENCY && i < symbols.length; i++) {
        workerPromises.push(worker());
      }

      // After each worker finishes, fire onBatch with partial result
      if (onBatch) {
        for (const p of workerPromises) {
          await p;
          batchCount++;
          // Pass a shallow copy of the current result so the callback can't mutate it mid-flight
          onBatch({ ...result });
        }
      } else {
        await Promise.allSettled(workerPromises);
      }
    }

    await runPool();
    writeCache(cacheKey, result);
    return result;
  }

  // ---- Spark batch: MANY symbols per request (vs 1 for v8 chart) ----
  // v7/finance/spark accepts comma-separated symbols and returns per-symbol
  // chart results — 111 stocks in ~5 requests instead of 111.
  async function sparkSnapshots(symbols) {
    const CHUNK = 25;
    const chunks = [];
    for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
    const out = {};
    const settled = await Promise.allSettled(chunks.map(async chunk => {
      const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=5d&interval=1d`;
      const json = await robustFetch(url);
      const results = json?.spark?.result || [];
      for (const r of results) {
        const resp = r?.response?.[0];
        if (!resp) continue;
        const snap = chartToSnapshot(r.symbol, { chart: { result: [resp] } });
        if (snap) out[r.symbol] = snap;
      }
    }));
    if (!Object.keys(out).length) {
      const err = settled.find(s => s.status === 'rejected');
      throw (err && err.reason) || new Error('spark empty');
    }
    return out;
  }

  /**
   * Snapshots for a list of symbols.
   * Order: fresh cache → stale-paint + spark batch (fast) → v7 batch → v8 pool.
   * When the market is closed, spark data is final — no 111-request pool at all.
   * @param {function} [onBatch] - callback with partial result object after each batch
   */
  async function snapshots(symbols, onBatch) {
    if (!symbols.length) return {};
    const cacheKey = 'v8snap_' + [...symbols].sort().join(',');

    const fresh = readCache(cacheKey, snapshotTtl());
    if (fresh) { if (onBatch) onBatch(fresh); return fresh; }

    // Instant paint: show last-known data immediately while refreshing
    const stale = readCache(cacheKey, Infinity, true);
    if (stale && onBatch) onBatch(stale);

    // Fastest path: PSX official market-watch — the WHOLE market in 1 request
    try {
      const mw = await psxMarketWatch();
      const subset = {};
      let hits = 0;
      for (const s of symbols) { if (mw[s]) { subset[s] = mw[s]; hits++; } }
      // Good enough when we cover most requested symbols (some tickers may be
      // renamed/delisted on the exchange — don't let a few gaps kill the fast path)
      if (hits >= symbols.length * 0.6) {
        for (const s of symbols) if (!subset[s]) subset[s] = stale?.[s] || { symbol: s, name: s, price: null, changePct: null, volume: null };
        writeCache(cacheKey, subset);
        if (onBatch) onBatch(subset);
        return subset;
      }
    } catch (_) { /* PSX portal or proxies unavailable — fall through to Yahoo */ }

    // Fast path: batched spark quotes (a handful of requests for all symbols)
    let spark = null;
    try {
      spark = await sparkSnapshots(symbols);
      // spark has no volume — carry volumes over from last-known data
      if (stale) {
        for (const s of Object.keys(spark)) {
          if (spark[s].volume == null && stale[s]?.volume != null) spark[s].volume = stale[s].volume;
        }
      }
      if (onBatch) onBatch(spark);
      if (!isMarketOpen()) {
        // Market closed: spark closes are final — skip the expensive pool
        writeCache(cacheKey, spark);
        return spark;
      }
    } catch (_) { /* spark unavailable — continue */ }

    // Try v7 batch exactly once per session
    if (!v7BatchDead) {
      try {
        const batchResult = await tryV7Batch(symbols);
        if (batchResult) {
          if (onBatch) onBatch(batchResult);
          return batchResult;
        }
      } catch (_) {
        // v7 is dead, mark and fall through
      }
      v7BatchDead = true;
    }

    return v8SnapshotPool(symbols, onBatch, spark || stale);
  }

  /**
   * Get all stock snapshots (defaults to ALL KSE-100 stocks).
   * @param {function} [onBatch] - callback with partial result object after each batch
   */
  async function allSnapshots(symbols = null, onBatch) {
    const syms = symbols || KSE100_STOCKS.map(s => s.symbol);
    return snapshots(syms, onBatch);
  }

  // ── v7 batch attempt (one-shot, killed on first failure) ──
  async function tryV7Batch(symbols) {
    const BATCH_CHUNK = 40;
    const YH_QUOTE_HOSTS = [
      'https://query1.finance.yahoo.com/v7/finance/quote',
      'https://query2.finance.yahoo.com/v7/finance/quote',
    ];
    const result = {};
    const chunks = [];
    for (let i = 0; i < symbols.length; i += BATCH_CHUNK) {
      chunks.push(symbols.slice(i, i + BATCH_CHUNK));
    }

    for (const chunk of chunks) {
      const symbolsParam = chunk.join(',');
      let success = false;

      for (const host of YH_QUOTE_HOSTS) {
        try {
          const url = `${host}?symbols=${encodeURIComponent(symbolsParam)}`;
          const json = await robustFetch(url);
          const quoteResponse = json?.quoteResponse;
          if (!quoteResponse || !quoteResponse.result) continue;

          for (const q of quoteResponse.result) {
            const sym = q.symbol;
            const price = q.regularMarketPrice;
            const prevClose = q.regularMarketPreviousClose;
            let changePct = q.regularMarketChangePercent;
            if (changePct != null && Math.abs(changePct) > 40) {
              changePct = (price && prevClose) ? ((price - prevClose) / Math.abs(prevClose)) * 100 : null;
            }
            if ((changePct == null || isNaN(changePct)) && prevClose && price != null) {
              changePct = ((price - prevClose) / Math.abs(prevClose)) * 100;
            }
            result[sym] = {
              symbol: sym,
              name: q.longName || q.shortName || sym,
              price: price ?? null,
              previousClose: prevClose ?? null,
              changePct: changePct ?? null,
              volume: q.regularMarketVolume ?? null,
              high52w: q.fiftyTwoWeekHigh ?? null,
              low52w: q.fiftyTwoWeekLow ?? null,
              currency: q.currency || 'PKR',
              timezone: q.timezone || 'PKT',
              marketCap: q.marketCap ?? null,
            };
          }
          success = true;
          break;
        } catch (e) {
          if (e.message === 'rate-limited') break;
        }
      }

      if (!success) {
        // One chunk failed => v7 is dead for this session
        throw new Error('v7 batch failed');
      }
    }

    return result;
  }

  // ════════════════════════════════════════════
  // Convenience wrappers
  // ════════════════════════════════════════════

  async function chartForAnalysis(symbol, lookbackDays = 250) {
    const range = lookbackDays <= 5 ? '5d'
      : lookbackDays <= 30 ? '1mo'
      : lookbackDays <= 90 ? '3mo'
      : lookbackDays <= 180 ? '6mo'
      : lookbackDays <= 365 ? '1y'
      : lookbackDays <= 730 ? '2y'
      : lookbackDays <= 1825 ? '5y'
      : 'max';
    return fetchChart(symbol, range, '1d');
  }

  async function chartForDisplay(symbol, chartRange = '3mo') {
    return fetchChart(symbol, chartRange, '1d');
  }

  async function kse100Index(range = '3mo') {
    try {
      return await fetchChart('^KSE', range, '1d');
    } catch (e) {
      // Yahoo rate-limited → PSX official intraday index (1d shape, but keeps
      // the dashboard alive with a real index number)
      return psxIndexChart('KSE100');
    }
  }

  async function kse100IndexWithInterval(range, interval) {
    return fetchChart('^KSE', range, interval);
  }

  async function chartForDisplayWithInterval(symbol, range, interval) {
    return fetchChart(symbol, range, interval);
  }

  return {
    fetchChart,
    chartForAnalysis,
    chartForDisplay,
    chartForDisplayWithInterval,
    snapshots,
    allSnapshots,
    kse100Index,
    kse100IndexWithInterval,
    isMarketOpen,
    psxMarketWatch,
    psxIndexChart
  };
})();
