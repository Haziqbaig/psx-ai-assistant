# 📈 StockSage AI — PSX Intelligence Terminal

**StockSage AI** is a professional, fully static web app for analyzing the **Pakistan Stock Exchange (PSX)** and its flagship **KSE-100** index. It delivers live prices, a full technical-indicator engine, and rule-based AI-style Buy/Sell recommendations — all client-side, deployable on GitHub Pages with zero backend.

> Inspired by (and a fresh sibling of) CryptoSage AI — rebuilt from the ground up for equities with a Bloomberg-terminal-meets-modern-dark aesthetic.

---

## ✨ Features

### Core
- **Dashboard** — KSE-100 index with sparkline, market breadth (advance/decline), derived market sentiment, top gainers / losers / most active, sector performance bars, and AI market insights.
- **Watchlist** — Track any KSE-100 stock with live price (PKR), daily change, volume, RSI(14), MACD, MA trend, support/resistance, and an AI rating badge (tap “Why?” for reasoning).
- **Stock Detail** — Chart.js price chart (1M / 3M / 6M / 1Y / 2Y), full indicator grid, 52-week high/low, market cap, P/E ratio, sector, and a detailed AI rating card with entry/exit/target/stop.
- **Search** — Instant client-side search across all KSE-100 constituents (name, symbol, sector).
- **Settings** — Dark/light theme (persisted), PKR currency, browser notifications, watchlist reset, cache clear.

### New (vs. crypto version)
- **📊 Sector Analysis** — All KSE-100 stocks grouped by sector with average performance, up/down counts, and expandable per-sector stock lists.
- **📶 Market Breadth** — Advance/decline ratio, up/down volume ratio, and market bias (Bullish / Neutral / Bearish).
- **💰 Dividend & Valuation context** — P/E ratio and dividend-yield signals feed the recommendation engine.
- **🏛️ KSE-100 Index tracking** — The index itself is charted and analyzed with the full indicator suite.
- **🕒 PSX Trading-hours clock** — Live status (Pre-Market / Open / Closed) for Mon–Thu 9:30–15:30 and Fri 9:30–12:30 PKT.
- **📟 Ticker tape** — Scrolling live quotes across the top.

---

## 🏗️ Architecture

Fully static — HTML + vanilla JS ES modules + Tailwind (CDN) + Chart.js (CDN). No build step, no server, no API keys.

```
psx-ai-assistant/
├── index.html            # Shell, Tailwind config, terminal styles, ticker tape
├── js/
│   ├── stocks.js         # KSE-100 constituents (111 stocks) with sector/marketCap/PE metadata
│   ├── sectors.js        # Sector grouping, sector performance, market breadth
│   ├── api.js            # Data layer — Yahoo Finance query2 API, cached fetch, request queue
│   ├── indicators.js     # RSI, MACD, EMA, SMA, Bollinger, support/resistance, 52w metrics
│   ├── recommend.js      # Rule-based scoring → Strong Buy … Strong Sell (with PE/dividend/sector)
│   ├── ui.js             # Money/pct formatting, rating badges, skeletons, toast, trading clock
│   └── app.js            # Routing, views, state, Chart.js integration, alerts, search
├── test/
│   └── indicators.test.js
└── README.md
```

### Data flow
1. `api.js` fetches from `https://query2.finance.yahoo.com/v8/finance/chart/<SYMBOL>` (PSX symbols use the `.KA` Karachi suffix; the KSE-100 index is `^KSE`).
2. Responses are normalized to `{ prices, total_volumes, candles, meta }` and cached in `localStorage` (per-endpoint TTL: 2 min intraday, 10 min daily). A serialized request queue with min-spacing avoids rate limits.
3. `indicators.analyze()` turns a daily close series into an indicator snapshot.
4. `recommend.recommend()` scores that snapshot (plus stock metadata and sector context) into a rating with reasons, confidence, risk, target, and stop.
5. `app.js` renders everything and wires Chart.js, alerts, and search.

---

## 🎯 Recommendation Engine

Rule-based, transparent scoring (−10 … +10) combining:
- **RSI(14)** — oversold/overbought zones
- **MACD(12,26,9)** — fresh crosses + histogram momentum
- **EMA 20/50/200** — trend + alignment (golden/death cross)
- **7d & 30d momentum**
- **Volume trend** (accumulation/distribution)
- **Bollinger Bands** — mean-reversion & squeeze
- **52-week range** position
- **P/E ratio** (value vs. growth)
- **Dividend yield** (income tilt)
- **Sector context** (rotation)

Mapped to: **Strong Buy · Buy · Hold · Reduce · Sell · Strong Sell** with confidence %, risk level, entry/exit guidance, target and stop-loss.

> ⚠️ All analysis is rule-based and **not investment advice**.

---

## 🚀 Run locally

No build needed. Serve the folder with any static server:

```bash
cd psx-ai-assistant
python3 -m http.server 8080
# open http://localhost:8080
```

(Opening `index.html` directly via `file://` mostly works, but a local server avoids browser fetch quirks.)

## 🧪 Tests

```bash
cd psx-ai-assistant
node test/indicators.test.js
```

Covers SMA, EMA, RSI (incl. Wilder reference value), MACD, Bollinger, support/resistance, 52-week metrics, weekly analysis, and end-to-end recommendation scenarios (uptrend / rollover / oversold).

---

## 🌐 Deploy to GitHub Pages

1. Push this folder to a GitHub repo (see deploy instructions below).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Site goes live at `https://<username>.github.io/psx-ai-assistant/`.

---

## 📊 Data Source

- **Yahoo Finance** (`query2.finance.yahoo.com`) — public chart endpoint, works client-side for PSX (Karachi) symbols with the `.KA` suffix, and `^KSE` for the KSE-100 index. Prices in PKR.
- KSE-100 constituents are **hardcoded** in `js/stocks.js` (the index composition changes infrequently — update the list periodically).

> Note: Yahoo's free endpoint can occasionally rate-limit or return stale index values. The app caches aggressively and degrades gracefully (skeletons, retry buttons, stale-cache fallback).

---

## 📝 License

For educational/demo use. Not affiliated with the Pakistan Stock Exchange or Yahoo. Not investment advice.
