/**
 * recommend.js — Rule-based stock recommendation engine for StockSage AI.
 * Combines RSI, MACD, EMA trend, momentum, volume, sector context into a score.
 * Stock-specific adjustments: PE ratio checks, dividend considerations, sector rotation signals.
 */
const Recommend = (() => {

  /**
   * Score an indicator snapshot and return a recommendation.
   * @param {object} ind result of Indicators.analyze
   * @param {object|null} stockMeta { sector, peRatio, marketCap, dividendYield }
   * @param {object|null} sectorContext { sectorAvgChange, breadthBias }
   * @returns {{rating:string, score:number, confidence:number, reasons:string[], risk:string,
   *            target:number|null, stopLoss:number|null, entry:string, exit:string}}
   */
  function recommend(ind, stockMeta = null, sectorContext = null) {
    let score = 0; // -10 … +10
    const reasons = [];

    // RSI
    if (ind.rsi != null) {
      if (ind.rsi < 30) { score += 2.5; reasons.push(`RSI ${ind.rsi.toFixed(0)} — oversold, potential bounce`); }
      else if (ind.rsi < 40) { score += 1.5; reasons.push(`RSI ${ind.rsi.toFixed(0)} — approaching oversold, watch for reversal`); }
      else if (ind.rsi < 50) { score += 0.5; reasons.push(`RSI ${ind.rsi.toFixed(0)} — below neutral, room to run`); }
      else if (ind.rsi > 70) { score -= 2.5; reasons.push(`RSI ${ind.rsi.toFixed(0)} — overbought, pullback risk`); }
      else if (ind.rsi > 60) { score -= 1; reasons.push(`RSI ${ind.rsi.toFixed(0)} — elevated`); }
      else reasons.push(`RSI ${ind.rsi.toFixed(0)} — neutral`);
    }

    // MACD
    if (ind.macd) {
      if (ind.macd.cross === 'bullish') { score += 2.5; reasons.push('Fresh MACD bullish cross — momentum shift'); }
      else if (ind.macd.cross === 'bearish') { score -= 2.5; reasons.push('Fresh MACD bearish cross — caution'); }
      else if (ind.macd.momentum === 'bullish') { score += 1; reasons.push('MACD histogram positive — momentum intact'); }
      else if (ind.macd.momentum === 'bearish') { score -= 1; reasons.push('MACD histogram negative — losing steam'); }
    }

    // EMA trend alignment
    const { price, ema20, ema50, ema200 } = ind;
    if (ema50 != null) {
      if (price > ema50) { score += 1; reasons.push('Price above 50-day EMA — uptrend'); }
      else { score -= 1; reasons.push('Price below 50-day EMA — downtrend'); }
    }
    if (ema20 != null && ema50 != null && ema200 != null) {
      if (ema20 > ema50 && ema50 > ema200) { score += 2; reasons.push('EMAs fully aligned bullish (20>50>200)'); }
      else if (ema20 < ema50 && ema50 < ema200) { score -= 2; reasons.push('EMAs fully aligned bearish — golden cross broken'); }
    }

    // Momentum
    if (ind.mom7d > 5) { score += 0.75; reasons.push(`Positive 7d momentum +${ind.mom7d.toFixed(1)}%`); }
    else if (ind.mom7d < -5) { score -= 0.75; reasons.push(`Sharp 7d decline ${ind.mom7d.toFixed(1)}%`); }

    if (ind.mom30d > 10) { score += 1; reasons.push(`Strong 30d momentum +${ind.mom30d.toFixed(1)}%`); }
    else if (ind.mom30d < -10) { score -= 1; reasons.push(`Weak 30d momentum ${ind.mom30d.toFixed(1)}%`); }

    // Volume trend
    if (ind.volTrend > 25) { score += 0.5; reasons.push('Rising volume confirms accumulation'); }
    else if (ind.volTrend < -25) { score -= 0.5; reasons.push('Falling volume — fading interest'); }

    // Bollinger Band position
    if (ind.bbLower != null && ind.bbUpper != null) {
      const bbWidth = (ind.bbUpper - ind.bbLower) / ind.bbMiddle;
      if (price <= ind.bbLower * 1.02) { score += 1; reasons.push('Price near lower Bollinger Band — mean reversion likely'); }
      else if (price >= ind.bbUpper * 0.98) { score -= 1; reasons.push('Price near upper Bollinger Band — extended'); }
      if (bbWidth < 0.05) { score += 0.5; reasons.push('Bollinger Band squeeze — potential breakout ahead'); }
    }

    // 52-week range position
    if (ind.pctFrom52wHigh != null && ind.pctFrom52wLow != null) {
      if (ind.pctFrom52wHigh < -20) { score += 0.5; reasons.push('Far from 52-week high — deep value territory'); }
      if (ind.pctFrom52wHigh > -3) { score -= 0.5; reasons.push('Near 52-week high — limited upside'); }
    }

    // PE ratio context (stock-specific)
    if (stockMeta && stockMeta.peRatio != null) {
      if (stockMeta.peRatio < 5) { score += 0.75; reasons.push(`Low PE of ${stockMeta.peRatio.toFixed(1)}x — deep value`); }
      else if (stockMeta.peRatio < 10) { score += 0.25; reasons.push(`PE ${stockMeta.peRatio.toFixed(1)}x — fairly valued`); }
      else if (stockMeta.peRatio > 25) { score -= 0.5; reasons.push(`High PE of ${stockMeta.peRatio.toFixed(1)}x — growth priced in`); }
    }

    // Dividend yield
    if (stockMeta && stockMeta.dividendYield != null && stockMeta.dividendYield > 0) {
      if (stockMeta.dividendYield > 8) { score += 0.5; reasons.push(`High dividend yield ${stockMeta.dividendYield.toFixed(1)}% — income play`); }
      else if (stockMeta.dividendYield > 4) { score += 0.25; reasons.push(`Dividend yield ${stockMeta.dividendYield.toFixed(1)}%`); }
    }

    // Sector context
    if (sectorContext && sectorContext.sectorAvgChange != null) {
      if (sectorContext.sectorAvgChange > 2) { score += 0.5; reasons.push('Sector showing strong momentum'); }
      else if (sectorContext.sectorAvgChange < -2) { score -= 0.5; reasons.push('Sector under pressure — headwinds'); }
    }

    // Map score → rating
    let rating;
    if (score >= 5.5) rating = 'Strong Buy';
    else if (score >= 3) rating = 'Buy';
    else if (score > -1.5) rating = 'Hold';
    else if (score > -3.5) rating = 'Reduce';
    else if (score > -5.5) rating = 'Sell';
    else rating = 'Strong Sell';

    const confidence = Math.min(95, Math.round(50 + Math.abs(score) * 5.5));
    const volatility = ind.bbUpper && ind.bbLower && ind.bbMiddle
      ? (ind.bbUpper - ind.bbLower) / ind.bbMiddle : 0.1;
    const risk = volatility > 0.3 ? 'High' : volatility > 0.15 ? 'Medium' : 'Low';

    const target = ind.resistance ?? null;
    const stopLoss = ind.support ?? null;
    const entry = score >= 3
      ? (ind.support ? `Accumulate near support ~${fmt(stopLoss)} or on breakout above ${fmt(target)}` : 'Accumulate on pullbacks')
      : score >= 0 ? 'Wait for a clearer setup; buy near support only'
      : 'Avoid new entries until trend improves';
    const exit = score <= -2.5
      ? `Reduce into strength; exit below support ${fmt(stopLoss)}`
      : `Take partial profits near resistance ${fmt(target)}; stop below ${fmt(stopLoss)}`;

    return { rating, score: +score.toFixed(1), confidence, reasons, risk, target, stopLoss, entry, exit };
  }

  function fmt(v) {
    if (v == null) return '—';
    return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : v >= 1 ? v.toFixed(2) : v.toPrecision(3);
  }

  return { recommend };
})();
if (typeof module !== 'undefined') module.exports = Recommend;