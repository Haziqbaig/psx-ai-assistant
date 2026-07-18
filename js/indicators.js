/**
 * indicators.js — Technical indicator engine for StockSage AI.
 * Adapted from CryptoSage for stock market data.
 * Pure functions over arrays of closing prices (oldest → newest).
 */
const Indicators = (() => {

  /** Simple Moving Average of last `period` values at each index (returns array aligned with input; nulls until enough data). */
  function sma(prices, period) {
    const out = new Array(prices.length).fill(null);
    let sum = 0;
    for (let i = 0; i < prices.length; i++) {
      sum += prices[i];
      if (i >= period) sum -= prices[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  /** Exponential Moving Average (seeded with SMA). */
  function ema(prices, period) {
    const out = new Array(prices.length).fill(null);
    if (prices.length < period) return out;
    const k = 2 / (period + 1);
    let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < prices.length; i++) {
      prev = prices[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  /** RSI(period) using Wilder's smoothing. Returns array aligned with input. */
  function rsi(prices, period = 14) {
    const out = new Array(prices.length).fill(null);
    if (prices.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = prices[i] - prices[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgGain = gain / period, avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  /** MACD(12,26,9): returns { macd[], signal[], histogram[], cross, momentum }. */
  function macd(prices, fast = 12, slow = 26, signalP = 9) {
    const emaFast = ema(prices, fast);
    const emaSlow = ema(prices, slow);
    const macdLine = prices.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null);
    const valid = macdLine.filter(v => v != null);
    const sigValid = ema(valid, signalP);
    const offset = macdLine.length - valid.length;
    const signal = new Array(prices.length).fill(null);
    for (let i = 0; i < sigValid.length; i++) signal[offset + i] = sigValid[i];
    const histogram = macdLine.map((v, i) => v != null && signal[i] != null ? v - signal[i] : null);
    let cross = 'none';
    for (let i = prices.length - 1; i > 0 && i > prices.length - 6; i--) {
      if (histogram[i] == null || histogram[i - 1] == null) break;
      if (histogram[i - 1] <= 0 && histogram[i] > 0) { cross = 'bullish'; break; }
      if (histogram[i - 1] >= 0 && histogram[i] < 0) { cross = 'bearish'; break; }
    }
    const last = histogram[prices.length - 1];
    return { macd: macdLine, signal, histogram, cross, momentum: last == null ? 'none' : (last > 0 ? 'bullish' : 'bearish') };
  }

  /** Bollinger Bands(period, mult). Returns { middle[], upper[], lower[] }. */
  function bollinger(prices, period = 20, mult = 2) {
    const middle = sma(prices, period);
    const upper = new Array(prices.length).fill(null);
    const lower = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1);
      const m = middle[i];
      const sd = Math.sqrt(slice.reduce((a, p) => a + (p - m) ** 2, 0) / period);
      upper[i] = m + mult * sd;
      lower[i] = m - mult * sd;
    }
    return { middle, upper, lower };
  }

  /**
   * Support/resistance from swing lows/highs (fractal method, 2-bar wings).
   * @returns {{support:number|null, resistance:number|null}}
   */
  function supportResistance(prices, lookback = 90) {
    const arr = prices.slice(-lookback);
    const price = arr[arr.length - 1];
    const lows = [], highs = [];
    for (let i = 2; i < arr.length - 2; i++) {
      if (arr[i] < arr[i-1] && arr[i] < arr[i-2] && arr[i] < arr[i+1] && arr[i] < arr[i+2]) lows.push(arr[i]);
      if (arr[i] > arr[i-1] && arr[i] > arr[i-2] && arr[i] > arr[i+1] && arr[i] > arr[i+2]) highs.push(arr[i]);
    }
    const support = lows.filter(l => l < price).sort((a, b) => b - a)[0]
      ?? Math.min(...arr);
    const resistance = highs.filter(h => h > price).sort((a, b) => a - b)[0]
      ?? Math.max(...arr);
    return { support, resistance };
  }

  /**
   * Compute full indicator snapshot from a daily price series.
   * @param {number[]} prices daily closes, oldest → newest
   * @param {number[]} [volumes]
   */
  function analyze(prices, volumes = []) {
    const last = prices[prices.length - 1];
    const r = rsi(prices, 14);
    const m = macd(prices);
    const e20 = ema(prices, 20), e50 = ema(prices, 50), e200 = ema(prices, 200);
    const bb = bollinger(prices);
    const sr = supportResistance(prices, 90);
    const n = prices.length - 1;
    // 7d momentum
    const mom7d = prices.length > 7 ? (last / prices[prices.length - 8] - 1) * 100 : 0;
    // 30d momentum
    const mom30d = prices.length > 30 ? (last / prices[prices.length - 31] - 1) * 100 : 0;
    // Volume trend: avg last 7 vs previous 7
    let volTrend = 0;
    if (volumes.length >= 14) {
      const recent = volumes.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const prev = volumes.slice(-14, -7).reduce((a, b) => a + b, 0) / 7;
      volTrend = prev > 0 ? (recent / prev - 1) * 100 : 0;
    }
    // 52-week position
    let pctFrom52wHigh = null, pctFrom52wLow = null;
    if (prices.length >= 52 * 5) { // ~260 trading days
      const yearHigh = Math.max(...prices.slice(-260));
      const yearLow = Math.min(...prices.slice(-260));
      pctFrom52wHigh = ((last - yearHigh) / yearHigh) * 100;
      pctFrom52wLow = ((last - yearLow) / yearLow) * 100;
    }
    return {
      price: last,
      rsi: r[n],
      macd: m,
      ema20: e20[n], ema50: e50[n], ema200: e200[n],
      bbUpper: bb.upper[n], bbLower: bb.lower[n], bbMiddle: bb.middle[n],
      support: sr.support, resistance: sr.resistance,
      mom7d, mom30d, volTrend,
      pctFrom52wHigh, pctFrom52wLow,
      maTrend: e50[n] != null ? (last > e50[n] ? 'up' : 'down') : 'flat',
    };
  }

  /**
   * Compute weekly indicators from daily data (for longer-term signals).
   * Groups daily closes into weekly candles, then runs analyze on weekly prices.
   */
  function analyzeWeekly(dailyPrices, dailyVolumes = []) {
    if (dailyPrices.length < 5) return analyze(dailyPrices, dailyVolumes);
    // Group by week (7 days)
    const weeklyPrices = [];
    const weeklyVolumes = [];
    for (let i = 0; i < dailyPrices.length; i += 5) {
      const chunk = dailyPrices.slice(i, i + 5);
      const volChunk = dailyVolumes.slice(i, i + 5);
      weeklyPrices.push(chunk[chunk.length - 1]); // Use closing price of the week
      weeklyVolumes.push(volChunk.reduce((a, b) => a + b, 0)); // Sum volume
    }
    return analyze(weeklyPrices, weeklyVolumes);
  }

  return { sma, ema, rsi, macd, bollinger, supportResistance, analyze, analyzeWeekly };
})();
if (typeof module !== 'undefined') module.exports = Indicators;