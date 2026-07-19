/**
 * api.js — Data layer for StockSage AI (PSX — Pakistan Stock Exchange).
 * Uses Yahoo Finance query2 API (client-side, no key needed).
 * All responses cached in localStorage with per-endpoint TTL.
 * 
 * PERF: Uses batched v7/finance/quote for snapshots (~3 requests for 95 stocks vs 95).
 */
const API = (() => {
  const YH = 'https://query2.finance.yahoo.com/v8/finance/chart';
  const YH1 = 'https://query1.finance.yahoo.com/v8/finance/chart';
  const YH_QUOTE_HOSTS = [
    'https://query1.finance.yahoo.com/v7/finance/quote',
    'https://query2.finance.yahoo.com/v7/finance/quote',
  ];
  const CACHE_PREFIX = 'ss_cache_';
  const DEFAULT_TTL = 120_000; // 2 min for intraday, longer for daily
  const SNAPSHOT_TTL = 60_000;  // 60s for batched snapshots
  const BATCH_CHUNK = 40;       // symbols per batch quote request

  // ---- CORS proxies (tried in order) ----
  const CORS_PROXIES = [
    { name: 'corsproxy',  build: (u) => ({ url: 'https://corsproxy.io/?' + encodeURIComponent(u), wrapped: false }) },
    { name: 'allorigins', build: (u) => ({ url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), wrapped: false }) },
    { name: 'codetabs',   build: (u) => ({ url: 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u), wrapped: false }) },
  ];

  // ---- Chart transports (direct + proxies, for fetchChart) ----
  const TRANSPORTS = [
    { name: 'direct',     build: (u) => ({ url: u, wrapped: false }) },
    { name: 'allorigins', build: (u) => ({ url: 'https://api.allorigins.win/get?url=' + encodeURIComponent(u), wrapped: true }) },
    { name: 'codetabs',   build: (u) => ({ url: 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u), wrapped: false }) },
    { name: 'corsproxy',  build: (u) => ({ url: 'https://corsproxy.io/?' + encodeURIComponent(u), wrapped: false }) },
    { name: 'thingproxy', build: (u) => ({ url: 'https://thingproxy.freeboard.io/fetch/' + u, wrapped: false }) },
  ];
  let preferredTransport = 0;

  /**
   * Robust fetch with CORS proxy fallback.
   * Tries direct fetch first, then each CORS proxy in order.
   * @param {string} url - the original URL to fetch
   * @param {object} [opts] - extra fetch options
   * @returns {Promise<Response>}
   */
  async function robustFetch(url, opts = {}) {
    const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };

    // Try direct first
    try {
      const res = await fetch(url, { ...opts, headers });
      if (res.ok) return res;
      if (res.status === 429) throw new Error('rate-limited');
    } catch (e) {
      if (e.message === 'rate-limited') throw e;
      // Fall through to proxies
    }

    // Try proxies
    let lastErr;
    for (const proxy of CORS_PROXIES) {
      try {
        const { url: proxyUrl } = proxy.build(url);
        const res = await fetch(proxyUrl, { ...opts, headers });
        if (res.ok) return res;
        if (res.status === 429) { lastErr = new Error('rate-limited'); continue; }
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('all proxies failed');
  }

  /**
   * Fetch a Yahoo chart URL through the transport chain; returns parsed chart JSON.
   */
  async function fetchViaTransports(yahooUrl) {
    const order = [preferredTransport, ...TRANSPORTS.map((_, i) => i).filter(i => i !== preferredTransport)];
    let lastErr;
    for (const idx of order) {
      const t = TRANSPORTS[idx];
      try {
        const { url, wrapped } = t.build(yahooUrl);
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.status === 429) { lastErr = new Error('rate-limited'); continue; }
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
        let json;
        if (wrapped) {
          const outer = await res.json();
          if (!outer || typeof outer.contents !== 'string') { lastErr = new Error('bad wrap'); continue; }
          json = JSON.parse(outer.contents);
        } else {
          json = await res.json();
        }
        if (!json?.chart?.result?.[0]) { lastErr = new Error('no chart data'); continue; }
        preferredTransport = idx;
        return json;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('all transports failed');
  }

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
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), d: data })); }
    catch (e) { pruneCache(); }
  }

  function pruneCache() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
  }

  // ---- Request queue (reduced spacing — now mostly for detail views) ----
  const MIN_SPACING = 200;  // ms between requests (was 600; reduced now that batches handle bulk)
  let queueTail = Promise.resolve();
  let nextAllowedAt = 0;

  function enqueue(fn) {
    const run = queueTail.then(async () => {
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      return fn();
    });
    queueTail = run.catch(() => {});
    return run;
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ════════════════════════════════════════════
  // BATCH QUOTE — the fast path for snapshots
  // ════════════════════════════════════════════

  /**
   * Fetch batch quotes for many symbols using Yahoo v7 quote endpoint.
   * Returns the same shape as snapshots(): { [symbol]: { symbol, name, price, previousClose,
   *   changePct, volume, high52w, low52w, currency } }
   * Uses localStorage cache with 60s TTL.
   */
  async function quoteBatch(symbols) {
    const cacheKey = 'quote_' + [...symbols].sort().join(',');
    const fresh = readCache(cacheKey, SNAPSHOT_TTL);
    if (fresh) return fresh;

    const result = {};

    // Split into chunks
    const chunks = [];
    for (let i = 0; i < symbols.length; i += BATCH_CHUNK) {
      chunks.push(symbols.slice(i, i + BATCH_CHUNK));
    }

    // Fetch all chunks in parallel
    const chunkPromises = chunks.map(async (chunk, idx) => {
      const symbolsParam = chunk.join(',');
      let lastErr;

      for (let attempt = 0; attempt < 2; attempt++) {
        // Try each Yahoo host
        for (const host of YH_QUOTE_HOSTS) {
          try {
            const url = `${host}?symbols=${encodeURIComponent(symbolsParam)}`;
            const res = await robustFetch(url);
            const json = await res.json();
            const quoteResponse = json?.quoteResponse;
            if (!quoteResponse || !quoteResponse.result) {
              lastErr = new Error('no quote data');
              continue;
            }

            for (const q of quoteResponse.result) {
              const sym = q.symbol;
              if (!result[sym]) {
                const price = q.regularMarketPrice;
                const prevClose = q.regularMarketPreviousClose;
                let changePct = q.regularMarketChangePercent;
                // If changePct is absurd (>40%), recalculate from price/prev
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
            }
            nextAllowedAt = Date.now() + MIN_SPACING;
            return; // chunk succeeded
          } catch (e) {
            lastErr = e;
            if (e.message === 'rate-limited') break; // don't retry other host, wait
          }
        }
        if (lastErr && lastErr.message !== 'rate-limited' && attempt < 1) {
          await sleep(1000);
        }
      }

      // Chunk failed — fill with error entries
      console.warn('quoteBatch chunk failed:', lastErr);
      for (const sym of chunk) {
        if (!result[sym]) {
          result[sym] = { symbol: sym, name: sym, price: null, changePct: null, volume: null, error: lastErr?.message || 'unknown' };
        }
      }
    });

    await Promise.allSettled(chunkPromises);
    writeCache(cacheKey, result);
    return result;
  }

  // ════════════════════════════════════════════
  // FETCH CHART (individual symbol, for detail views)
  // ════════════════════════════════════════════

  /**
   * Fetch chart data from Yahoo Finance.
   * Returns normalized { prices, volumes, candles, meta } or throws.
   */
  async function fetchChart(symbol, range = '3mo', interval = '1d') {
    const yahooUrl = `${YH}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
    const cacheKey = `chart_${symbol}_${range}_${interval}`;
    const ttl = (range === '1d' || range === '5d') ? 120_000 : 600_000;

    const fresh = readCache(cacheKey, ttl);
    if (fresh) return fresh;

    return enqueue(async () => {
      const again = readCache(cacheKey, ttl);
      if (again) return again;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const json = await fetchViaTransports(yahooUrl);
          const result = json.chart?.result?.[0];
          if (!result) throw new Error('No chart data');

          const meta = result.meta || {};
          const ts = result.timestamp || [];
          const quotes = result.indicators?.quote?.[0] || {};
          const adjclose = result.indicators?.adjclose?.[0] || {};

          const opens = quotes.open || [];
          const highs = quotes.high || [];
          const lows = quotes.low || [];
          const closes = adjclose?.adjclose || quotes.close || [];
          const volumes = quotes.volume || [];

          const prices = [];
          const vols = [];
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

          if (!prices.length && ts.length && opens.length) {
            for (let i = 0; i < ts.length; i++) {
              if (opens[i] != null) {
                prices.push([ts[i] * 1000, opens[i]]);
                vols.push([ts[i] * 1000, volumes[i] || 0]);
                candles.push({
                  t: ts[i] * 1000,
                  o: opens[i], h: highs[i] || opens[i],
                  l: lows[i] || opens[i], c: closes[i] || opens[i]
                });
              }
            }
          }

          const data = {
            prices,
            total_volumes: vols,
            candles,
            meta: {
              price: meta.regularMarketPrice,
              currency: meta.currency || 'PKR',
              name: meta.longName || meta.shortName || symbol,
              previousClose: meta.chartPreviousClose,
              high52w: meta.fiftyTwoWeekHigh,
              low52w: meta.fiftyTwoWeekLow,
              exchangeName: meta.fullExchangeName || meta.exchangeName || 'PSX',
              timezone: meta.timezone || 'PKT',
              gmtoffset: meta.gmtoffset || 18000,
              tradingPeriod: meta.currentTradingPeriod || null
            }
          };

          writeCache(cacheKey, data);
          nextAllowedAt = Date.now() + MIN_SPACING;
          return data;
        } catch (e) {
          if (attempt < 1 && e.message !== 'rate-limited') {
            await sleep(1500);
          } else {
            const stale = readCache(cacheKey, Infinity, true);
            if (stale) return stale;
            throw e;
          }
        }
      }
    });
  }

  // ════════════════════════════════════════════
  // SNAPSHOTS — individual (legacy compat), now powered by quoteBatch
  // ════════════════════════════════════════════

  /**
   * Fetch snapshots for a list of symbols. Uses batched quote endpoint (FAST).
   * Returns same shape as before.
   */
  async function snapshots(symbols) {
    return quoteBatch(symbols);
  }

  /**
   * Get all stock snapshots at once (batched internally via quoteBatch).
   * @param {string[]|null} symbols - defaults to ALL KSE-100 stocks
   */
  async function allSnapshots(symbols = null) {
    const syms = symbols || KSE100_STOCKS.map(s => s.symbol);
    return quoteBatch(syms);
  }

  /**
   * Get detailed chart data for technical analysis.
   */
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

  /**
   * Get chart data for display.
   */
  async function chartForDisplay(symbol, chartRange = '3mo') {
    return fetchChart(symbol, chartRange, '1d');
  }

  /**
   * Fetch KSE-100 index data.
   */
  async function kse100Index(range = '3mo') {
    return fetchChart('^KSE', range, '1d');
  }

  /**
   * Fetch KSE-100 index with custom interval (for intraday charts).
   */
  async function kse100IndexWithInterval(range, interval) {
    return fetchChart('^KSE', range, interval);
  }

  /**
   * Get chart data for display with explicit interval.
   */
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
    quoteBatch,
    kse100Index,
    kse100IndexWithInterval
  };
})();