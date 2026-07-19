/**
 * indicators.test.js — Unit tests for StockSage AI indicator engine.
 * Run: node test/indicators.test.js
 */

const Indicators = require('../js/indicators.js');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    console.error('  \u2717 ' + name);
    console.error('    ' + e.message);
  }
}

console.log('\nStockSage AI \u2014 Technical Indicator Tests\n');

// ---- SMA ----
test('SMA of [1..10] with period 3', () => {
  const sma = Indicators.sma([1,2,3,4,5,6,7,8,9,10], 3);
  assert.strictEqual(sma[0], null);
  assert.strictEqual(sma[1], null);
  assert.strictEqual(sma[2], 2);
  assert.strictEqual(sma[9], 9);
});

// ---- EMA ----
test('EMA of [1..10] with period 5', () => {
  const ema = Indicators.ema([1,2,3,4,5,6,7,8,9,10], 5);
  assert.ok(ema[4] > 2 && ema[4] < 4);
  assert.ok(ema[9] > 5);
});

// ---- RSI (classic Wilder values) ----
test('RSI of known data returns valid value', () => {
  const prices = [44,44.34,44.09,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,46.06];
  const rsi = Indicators.rsi(prices, 14);
  assert.ok(rsi[19] != null);
  assert.ok(rsi[19] >= 0 && rsi[19] <= 100);
  console.log('    RSI[19] = ' + Math.round(rsi[19]));
});

test('RSI uptrend (all gains) = 100', () => {
  const up = Array.from({length: 30}, (_, i) => 100 + i);
  const rsi = Indicators.rsi(up, 14);
  assert.ok(rsi[29] >= 99, 'Expected near 100, got ' + rsi[29]);
});

test('RSI downtrend (all losses) near 0', () => {
  const down = Array.from({length: 30}, (_, i) => 200 - i);
  const rsi = Indicators.rsi(down, 14);
  assert.ok(rsi[29] <= 5, 'Expected near 0, got ' + rsi[29]);
});

// ---- MACD ----
test('MACD returns correct structure', () => {
  const prices = [];
  for (let i = 0; i < 40; i++) prices.push(100 + i + Math.sin(i / 3) * 5);
  const macd = Indicators.macd(prices);
  assert.ok(macd.macd.length === prices.length);
  assert.ok(macd.signal.length === prices.length);
  assert.ok(macd.histogram.length === prices.length);
  assert.ok(['bullish','bearish','none'].includes(macd.momentum));
  assert.ok(['bullish','bearish','none'].includes(macd.cross));
});

// ---- Bollinger Bands ----
test('Bollinger Bands: upper > middle > lower', () => {
  const prices = [];
  for (let i = 0; i < 30; i++) prices.push(100 + Math.sin(i) * 10);
  const bb = Indicators.bollinger(prices, 20, 2);
  assert.ok(bb.upper[29] > bb.middle[29], 'Upper not above middle');
  assert.ok(bb.lower[29] < bb.middle[29], 'Lower not below middle');
});

// ---- Support/Resistance ----
test('supportResistance finds valid levels', () => {
  const prices = [];
  for (let i = 0; i < 100; i++) prices.push(100 + Math.sin(i / 5) * 20);
  const sr = Indicators.supportResistance(prices, 90);
  assert.ok(sr.support != null);
  assert.ok(sr.resistance != null);
  assert.ok(sr.support <= sr.resistance, 'Support should be <= resistance');
});

// ---- Full analyze ----
test('analyze returns complete indicator snapshot on uptrend', () => {
  const prices = [];
  for (let i = 0; i < 200; i++) prices.push(100 + i * 0.5 + Math.sin(i / 10) * 15);
  const volumes = prices.map(() => Math.random() * 100000);
  const result = Indicators.analyze(prices, volumes);
  assert.ok(result.price > 0, 'Price should be positive');
  assert.ok(result.rsi != null, 'RSI should not be null');
  assert.ok(result.rsi >= 0 && result.rsi <= 100, 'RSI in range 0-100');
  assert.ok(result.ema20 != null);
  assert.ok(result.ema50 != null);
  assert.ok(result.ema200 != null);
  assert.ok(result.support != null);
  assert.ok(result.resistance != null);
  assert.ok(result.bbUpper != null && result.bbLower != null);
  assert.ok(['up','down','flat'].includes(result.maTrend));
  console.log('    Price: ' + Math.round(result.price) + ' | RSI: ' + Math.round(result.rsi) + ' | Trend: ' + result.maTrend);
});

test('analyze handles minimal price series', () => {
  const prices = [100,101,102,103,104,105,106,107,108,109];
  const result = Indicators.analyze(prices);
  assert.ok(result.price === 109);
});

// ---- analyzeWeekly ----
test('analyzeWeekly groups daily data into weekly', () => {
  const prices = [];
  for (let i = 0; i < 250; i++) prices.push(100 + i * 0.2 + Math.sin(i / 5) * 8);
  const volumes = prices.map(() => Math.random() * 100000);
  const result = Indicators.analyzeWeekly(prices, volumes);
  assert.ok(result.price > 0);
  assert.ok(result.rsi != null);
});

// ---- Summary ----
console.log('\n' + '\u2500'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');

if (failed > 0) {
  console.log('\n\u274C Some tests FAILED');
  process.exit(1);
} else {
  console.log('\n\u2705 All indicator tests passed!');
  process.exit(0);
}