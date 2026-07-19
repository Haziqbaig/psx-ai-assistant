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
  const SNAPSHOT_TTL  = 60_000;  // 60s for snapshots
  const INTRADAY_TTL   = 120_000; // 2 min for 1D/5D charts
  const LONG_TTL       = 600_000; // 10 min for daily/weekly charts
  const CONCURRENCY     = 8;       // parallel chart requests for snapshot pool

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
  async function robustFetch(url) {
    // 1. Try direct — browser auto-sends its real User-Agent, Yahoo accepts it
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        return json;
      }
      if (res.status === 429) throw new Error('rate-limited');
    } catch (e) {
      if (e.message === 'rate-limited') throw e;
      // fall through to proxy
    }

    // 2. Last-resort CORS proxy (allorigins /get — returns {contents:"..."})
    try {
      const proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(url);
      const res = await fetch(proxyUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('proxy HTTP ' + res.status);
      const outer = await res.json();
      if (outer && typeof outer.contents === 'string') {
        return JSON.parse(outer.contents);
      }
      throw new Error('bad proxy wrap');
    } catch (e) {
      throw e;
    }
  }

  // ---- Build v8 chart URL ----
  function chartUrl(symbol, range, interval) {
    const host = YH_PRIMARY; // query1 is most reliable
    return `${host}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
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
  async function v8SnapshotPool(symbols, onBatch) {
    const cacheKey = 'v8snap_' + [...symbols].sort().join(',');
    const fresh = readCache(cacheKey, SNAPSHOT_TTL);
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
            const url = chartUrl(sym, '5d', '1d');
            const json = await robustFetch(url);
            const snap = chartToSnapshot(sym, json);
            result[sym] = snap || { symbol: sym, name: sym, price: null, changePct: null, volume: null };
          } catch (e) {
            result[sym] = { symbol: sym, name: sym, price: null, changePct: null, volume: null, error: e.message };
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

  /**
   * Snapshots for a list of symbols. Tries v7 batch once; falls back to v8 pool.
   * @param {function} [onBatch] - callback with partial result object after each batch
   */
  async function snapshots(symbols, onBatch) {
    if (!symbols.length) return {};

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

    return v8SnapshotPool(symbols, onBatch);
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
    return fetchChart('^KSE', range, '1d');
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
    kse100IndexWithInterval
  };
})();
