/**
 * sectors.js — Sector grouping and performance tracking for StockSage AI.
 */
const Sectors = (() => {

  /** Group stocks by their sector. */
  function groupBySector(stocks) {
    const groups = {};
    stocks.forEach(s => {
      (groups[s.sector] = groups[s.sector] || []).push(s);
    });
    return groups;
  }

  /**
   * Compute sector performance from live price data.
   * @param {Object<string, {price:number, changePct:number, volume:number}>} priceMap symbol → data
   * @returns {Array<{sector:string, avgChange:number, stockCount:number, upCount:number, downCount:number, totalVolume:number}>}
   */
  function sectorPerformance(priceMap) {
    const grouped = groupBySector(KSE100_STOCKS);
    const result = [];
    for (const [sector, stocks] of Object.entries(grouped)) {
      let totalChange = 0, count = 0, up = 0, down = 0, totalVol = 0;
      for (const s of stocks) {
        const p = priceMap[s.symbol];
        if (p && p.changePct != null) {
          totalChange += p.changePct;
          totalVol += (p.volume || 0);
          count++;
          if (p.changePct > 0) up++;
          else if (p.changePct < 0) down++;
        }
      }
      result.push({
        sector,
        avgChange: count ? totalChange / count : 0,
        stockCount: stocks.length,
        trackedCount: count,
        upCount: up,
        downCount: down,
        totalVolume: totalVol
      });
    }
    result.sort((a, b) => b.avgChange - a.avgChange);
    return result;
  }

  /**
   * Compute market breadth indicators from price data.
   * @param {Object<string, {price:number, changePct:number, volume:number}>} priceMap
   */
  function marketBreadth(priceMap) {
    let advances = 0, declines = 0, unchanged = 0;
    let totalVolume = 0, upVolume = 0, downVolume = 0;
    let entries = 0;
    for (const s of KSE100_STOCKS) {
      const p = priceMap[s.symbol];
      if (!p || p.changePct == null) continue;
      entries++;
      totalVolume += (p.volume || 0);
      if (p.changePct > 0.1) { advances++; upVolume += (p.volume || 0); }
      else if (p.changePct < -0.1) { declines++; downVolume += (p.volume || 0); }
      else unchanged++;
    }
    const total = advances + declines;
    const aDRatio = total > 0 ? (advances / total).toFixed(2) : '1.00';
    const volRatio = totalVolume > 0 ? (upVolume / totalVolume).toFixed(2) : '0.50';
    return {
      advances, declines, unchanged,
      advanceDeclineRatio: parseFloat(aDRatio),
      upDownVolumeRatio: parseFloat(volRatio),
      totalStocksTracked: entries,
      marketBias: advances > declines * 1.5 ? 'Bullish' : declines > advances * 1.5 ? 'Bearish' : 'Neutral'
    };
  }

  /** Get color for sector change display. */
  function sectorColor(change) {
    if (change > 2) return 'text-emerald-400';
    if (change > 0) return 'text-emerald-300';
    if (change > -1) return 'text-amber-400';
    if (change > -3) return 'text-orange-400';
    return 'text-rose-400';
  }

  return { groupBySector, sectorPerformance, marketBreadth, sectorColor, KSE100_STOCKS, STOCK_MAP, SECTORS_UNIQUE };
})();