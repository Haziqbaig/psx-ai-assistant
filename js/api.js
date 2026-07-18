/**
 * api.js — Data layer for StockSage AI (PSX — Pakistan Stock Exchange).
 * Uses Yahoo Finance query2 API (client-side, no key needed).
 * All responses cached in localStorage with per-endpoint TTL.
 */
const API = (() => {
  const YH = 'https://query2.finance.yahoo.com/v8/finance/chart';
  const YH1 = 'https://query1.finance.yahoo.com/v8/finance/chart';
  const CACHE_PREFIX = 'ss_cache_';
  const DEFAULT_TTL = 120_000; // 2 min for intraday, longer for daily

  // Yahoo Finance does NOT send CORS headers, so browser fetch is blocked cross-origin.
  // We try a chain of transports: direct (in case of an extension / future CORS), then
  // several public CORS proxies. The first that returns valid chart JSON wins, and the
  // winning transport index is remembered for the session to speed up later requests.
  // Each transport is a function (yahooUrl) => { url, wrapped } where `wrapped` means the
  // response body is JSON like {contents:"<stringified json>"} (allorigins /get style).
  const TRANSPORTS = [
    { name: 'direct',     build: (u) => ({ url: u, wrapped: false }) },
    { name: 'allorigins', build: (u) => ({ url: 'https://api.allorigins.win/get?url=' + encodeURIComponent(u), wrapped: true }) },
    { name: 'codetabs',   build: (u) => ({ url: 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u), wrapped: false }) },
    { name: 'corsproxy',  build: (u) => ({ url: 'https://corsproxy.io/?url=' + encodeURIComponent(u), wrapped: false }) },
    { name: 'thingproxy', build: (u) => ({ url: 'https://thingproxy.freeboard.io/fetch/' + u, wrapped: false }) },
  ];
  let preferredTransport = 0;

  /** Fetch a Yahoo URL through the transport chain; returns parsed chart JSON or throws. */
  async function fetchViaTransports(yahooUrl) {
    // Try preferred transport first, then the rest in order.
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
        preferredTransport = idx; // remember what worked
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

  // ---- Request queue to avoid rate limiting Yahoo ----
  const MIN_SPACING = 600;  // ms between requests
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

  /**
   * Fetch chart data from Yahoo Finance.
   * Returns normalized { prices, volumes, candles, meta } or throws.
   * @param {string} symbol e.g. "ENGRO.KA"
   * @param {string} range "1d"|"5d"|"1mo"|"3mo"|"6mo"|"1y"|"2y"|"5y"|"max"
   * @param {string} interval "1d"|"1wk"|"1mo"
   */
  async function fetchChart(symbol, range = '3mo', interval = '1d') {
    const yahooUrl = `${YH}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
    const cacheKey = `chart_${symbol}_${range}_${interval}`;
    // TTL: intraday ranges shorter; daily ranges longer
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

          // If no closes but we have open/high/low, use those
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

  /**
   * Fetch a batch of stock snapshots (current price + daily change).
   * Uses fetchChart with 2d range to get the latest close and previous close.
   * @param {string[]} symbols array of e.g. ["ENGRO.KA", "HUBC.KA"]
   * @returns {Object<string, {symbol, name, price, changePct, volume, high52w, low52w, currency}>}
   */
  async function snapshots(symbols) {
    const result = {};
    const batchSize = 3; // Small batches to avoid overwhelming Yahoo
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const promises = batch.map(async (sym) => {
        try {
          const data = await fetchChart(sym, '5d', '1d');
          const meta = data.meta;
          const prices = data.prices;
          // Prefer the chart's own last two closes — they are internally consistent.
          // Yahoo's meta.regularMarketPrice / chartPreviousClose can be stale for PSX,
          // producing absurd daily % changes, so we only use them as a fallback.
          let price = prices.length ? prices[prices.length - 1][1] : meta.price;
          let prevClose = prices.length >= 2 ? prices[prices.length - 2][1] : meta.previousClose;
          if (price == null || price === 0) price = meta.price;
          if (prevClose == null || prevClose === 0) prevClose = meta.previousClose;
          let changePct = (prevClose && price != null)
            ? ((price - prevClose) / Math.abs(prevClose)) * 100
            : null;
          // Sanity guard: a single PSX session rarely moves > 40%.
          // If we still see an implausible value, prevClose is bad data → treat change as null.
          if (changePct != null && Math.abs(changePct) > 40) changePct = null;
          const volume = data.total_volumes.length
            ? data.total_volumes[data.total_volumes.length - 1][1]
            : null;
          result[sym] = {
            symbol: sym,
            name: meta.name || sym,
            price: price,
            previousClose: prevClose,
            changePct: changePct,
            volume: volume,
            high52w: meta.high52w,
            low52w: meta.low52w,
            currency: meta.currency || 'PKR',
            timezone: meta.timezone || 'PKT'
          };
        } catch (e) {
          result[sym] = { symbol: sym, name: sym, price: null, changePct: null, volume: null, error: e.message };
        }
      });
      await Promise.allSettled(promises);
    }
    return result;
  }

  /**
   * Get detailed chart data for technical analysis — both daily and weekly.
   * Returns daily chart suitable for Indicators.analyze.
   * @param {string} symbol
   * @param {number} lookbackDays days of data needed (for EMA200, need 220+)
   */
  async function chartForAnalysis(symbol, lookbackDays = 250) {
    // Map days to Yahoo range string
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
   * Get chart data for display (specific range).
   * @param {string} symbol
   * @param {string} chartRange "1mo"|"3mo"|"6mo"|"1y"|"2y"|"5y"
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
   * Get all stock snapshots at once for the dashboard (paginated internally).
   * @param {number} maxConcurrent max parallel requests
   */
  async function allSnapshots(symbols = null, maxConcurrent = 4) {
    const syms = symbols || KSE100_STOCKS.map(s => s.symbol);
    const result = {};
    // Process in batches
    for (let i = 0; i < syms.length; i += maxConcurrent) {
      const batch = syms.slice(i, i + maxConcurrent);
      const batchResult = await snapshots(batch);
      Object.assign(result, batchResult);
    }
    return result;
  }

  return {
    fetchChart,
    chartForAnalysis,
    chartForDisplay,
    snapshots,
    allSnapshots,
    kse100Index
  };
})();