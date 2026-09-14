#!/usr/bin/env node
/**
 * fetch-data.mjs — Server-side PSX data fetcher for StockSage AI.
 * Runs in GitHub Actions (no CORS restrictions), writes static JSON that the
 * GitHub Pages frontend reads same-origin-style via raw.githubusercontent.com.
 *
 * Usage: node scripts/fetch-data.mjs <outputDir>
 *
 * Outputs (inside <outputDir>):
 *   snapshots.json    — { generated, marketOpen, snapshots: { 'OGDC.KA': {...} } }
 *   kse100_int.json   — { generated, data: <raw dps intraday json> }
 *   eod/<SYM>.json    — { generated, data: <raw dps eod json> }  (refreshed ~daily)
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'dataout';
const DPS = 'https://dps.psx.com.pk';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const EOD_MAX_AGE_MS = 20 * 3600_000; // refresh EOD roughly once a trading day

function isMarketOpen() {
  const pkt = new Date(Date.now() + 5 * 3600_000);
  const day = pkt.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 16 * 60 + 30;
}

async function get(url, as = 'text', tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Same parse logic as the frontend's psxMarketWatch(). */
function parseMarketWatch(html) {
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
    if (nums.length < 8) continue;
    const [ldcp, open, high, low, close, change, pct, volume] = nums;
    if (!close) continue;
    out[sym + '.KA'] = {
      symbol: sym + '.KA',
      name: name || sym,
      price: close,
      previousClose: ldcp || null,
      changePct: Number.isFinite(pct) ? pct : (ldcp ? ((close - ldcp) / ldcp) * 100 : null),
      volume: volume || null,
      high52w: null, low52w: null,
      dayHigh: high || null, dayLow: low || null, open: open || null,
      currency: 'PKR', timezone: 'PKT', marketCap: null,
    };
  }
  return out;
}

/** Load the KSE-100 symbol list straight from the frontend's stocks.js. */
async function loadSymbols() {
  const src = await readFile(new URL('../js/stocks.js', import.meta.url), 'utf8');
  const stocks = new Function(`${src}; return KSE100_STOCKS;`)();
  return stocks.map(s => s.symbol.replace(/\.KA$/, ''));
}

async function writeJson(file, obj) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj));
}

async function readGenerated(file) {
  try {
    if (!existsSync(file)) return 0;
    return JSON.parse(await readFile(file, 'utf8'))?.generated || 0;
  } catch { return 0; }
}

const now = Date.now();
let failures = 0;

// ── 1. Market-watch snapshots (every run) ──
try {
  const html = await get(`${DPS}/market-watch`);
  const snapshots = parseMarketWatch(html);
  const count = Object.keys(snapshots).length;
  if (!count) throw new Error('market-watch parse produced 0 rows');
  await writeJson(path.join(OUT, 'snapshots.json'), { generated: now, marketOpen: isMarketOpen(), count, snapshots });
  console.log(`snapshots.json: ${count} symbols`);
} catch (e) {
  failures++;
  console.error('market-watch FAILED:', e.message);
}

// ── 2. KSE-100 intraday index (every run) ──
try {
  const idx = await get(`${DPS}/timeseries/int/KSE100`, 'json');
  if (!idx?.data?.length) throw new Error('empty intraday index');
  await writeJson(path.join(OUT, 'kse100_int.json'), { generated: now, data: idx });
  console.log(`kse100_int.json: ${idx.data.length} points`);
} catch (e) {
  failures++;
  console.error('kse100 intraday FAILED:', e.message);
}

// ── 3. EOD timeseries for all constituents + index (~once a day) ──
const marker = path.join(OUT, 'eod', 'KSE100.json');
const eodAge = now - (await readGenerated(marker));
if (eodAge < EOD_MAX_AGE_MS) {
  console.log(`EOD data is fresh (${Math.round(eodAge / 3600_000)}h old) — skipping refresh`);
} else {
  const symbols = ['KSE100', ...(await loadSymbols())];
  let ok = 0, fail = 0;
  for (const sym of symbols) {
    try {
      const json = await get(`${DPS}/timeseries/eod/${sym}`, 'json');
      if (!json?.data?.length) throw new Error('empty');
      await writeJson(path.join(OUT, 'eod', `${sym}.json`), { generated: now, data: json });
      ok++;
    } catch (e) {
      fail++;
      console.error(`eod/${sym} FAILED: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 350)); // be polite to the exchange
  }
  console.log(`EOD refresh: ${ok} ok, ${fail} failed`);
  if (!ok) failures++;
}

if (failures) {
  console.error(`${failures} fatal section(s) failed`);
  process.exit(1);
}
console.log('done');
