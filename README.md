# 📈 StockSage AI — PSX Smart Dashboard

**StockSage AI** is a professional, fully static web application for analyzing the **Pakistan Stock Exchange (PSX)** and its flagship **KSE-100 index**. It delivers live prices, a full technical-indicator engine, and AI-style Buy/Sell recommendations — all client-side, deployable on GitHub Pages with zero backend dependencies.

> 🌐 **Live Demo:** [haziqbaig.github.io/psx-ai-assistant](https://haziqbaig.github.io/psx-ai-assistant/)

---

## ✨ Features

### Core Views
- **📊 Dashboard** — KSE-100 index stat card, market cap, traded volume, advance/decline ratio, market sentiment gauge (Bullish/Neutral/Bearish), top gainers, top losers, and most active stocks.
- **⭐ Watchlist** — Track KSE-100 stocks with live price (PKR), change%, volume, RSI, MACD, MA trend, and AI rating. Default watchlist: ENGRO, HUBC, LUCK, MEBL, SYS, FFC, OGDC, MCB.
- **🏭 Sectors** — Full sector analysis with expandable stock lists. Each sector card shows average performance, up/down counts, and a visual performance bar on a teal-to-rose spectrum.
- **📶 Market Breadth** — Advance/decline ratio gauge, up/down volume ratio, market bias indicator (Bullish/Neutral/Bearish), top advancing stocks, and top declining stocks.
- **🏛️ KSE-100 Index** — Interactive Chart.js line chart (1mo/3mo/6mo/1y range selectors) with RSI, MACD, EMA 20/50/200, MA trend indicators, and AI rating for the index itself.
- **🔍 Search** — Instant client-side search across all KSE-100 constituents by name, symbol, or sector.
- **📈 Stock Detail** — Per-stock deep dive with: interactive price chart, full technical indicator grid (RSI, MACD, EMA, Bollinger Bands, Support/Resistance), AI recommendation card (entry/exit, target/stop, confidence score), company info (market cap, P/E ratio, 52-week high/low).

### Smart Features
- **🧠 AI Recommendation Engine** — Rule-based scoring (−10 to +10) combining RSI, MACD, EMA alignment, momentum, volume trends, Bollinger Bands, 52-week range, P/E ratio, and sector context. Maps to: Strong Buy · Buy · Hold · Reduce · Sell · Strong Sell with confidence %, risk level, and entry/exit guidance.
- **🌙 Dark/Light Theme** — Toggle between a Bloomberg-terminal-inspired dark navy scheme and a clean light mode. Persisted to localStorage.
- **🕒 PSX Trading Clock** — Live status indicator (Pre-Market / Market Open / Market Closed) respecting PSX trading hours (Mon–Thu 9:30–15:30, Fri 9:30–12:30 PKT).
- **🔄 Auto-Refresh** — Sends live data every 2 minutes silently.
- **📱 Responsive** — Sidebar navigation on desktop, bottom tab bar on mobile. Fully responsive down to 320px width.
- **💾 Offline Resilience** — All API responses cached in localStorage with per-endpoint TTL. Stale cache used as fallback when Yahoo Finance rate-limits.

---

## 🏗️ Architecture

Fully static — HTML + vanilla JavaScript + Tailwind CSS (CDN) + Chart.js (CDN) + Font Awesome (CDN). No build step, no server, no API keys.

```
psx-ai-assistant/
├── index.html            # Shell, Tailwind config, CSS, sidebar/mobile nav
├── js/
│   ├── stocks.js         # KSE-100 constituents (~110 stocks) with sector, marketCap, PE
│   ├── api.js            # Yahoo Finance query2 API, request queue, localStorage cache
│   ├── indicators.js     # RSI, MACD, EMA, SMA, Bollinger, support/resistance, 52w metrics
│   ├── recommend.js      # Rule-based scoring engine (Strong Buy → Strong Sell)
│   ├── sectors.js        # Sector grouping, sector performance, market breadth
│   ├── ui.js             # Money/pct formatting, rating badges, skeletons, toast, trading clock
│   └── app.js            # Router, 7 views, Chart.js integration, state management
├── test/
│   └── indicators.test.js # Node.js unit tests (11 tests, all passing)
└── README.md
```

### Data Flow
1. **`api.js`** fetches from `https://query2.finance.yahoo.com/v8/finance/chart/<SYMBOL>`. PSX symbols use the `.KA` Karachi suffix; the KSE-100 index is `^KSE`.
2. Responses are normalized to `{ prices, total_volumes, candles, meta }` and cached in localStorage with per-endpoint TTL (2 min intraday, 10 min daily). A serialized request queue with 600ms min-spacing avoids rate limits.
3. **`indicators.analyze()`** processes a daily close series into a full technical snapshot (RSI, MACD, EMAs, Bollinger Bands, support/resistance, momentum, volume trends).
4. **`recommend.recommend()`** scores the snapshot (plus stock metadata — P/E, sector, dividends) into an actionable rating with reasons, confidence, risk level, entry/exit guidance, target, and stop-loss.
5. **`app.js`** renders everything using Chart.js for price charts, Font Awesome for icons, and a custom navy/teal/amber glass-morphism design system.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **UI Framework** | Tailwind CSS (CDN) |
| **Charts** | Chart.js 4.4 (CDN) |
| **Icons** | Font Awesome 6.4 (CDN) |
| **Font** | Inter (Google Fonts) |
| **Data Source** | Yahoo Finance query2 (no API key) |
| **Language** | Vanilla JavaScript (ES6+) |
| **Testing** | Node.js `assert` module |
| **Hosting** | GitHub Pages (static) |

---

## 🚀 How to Run Locally

No build step needed. Serve the folder with any static server:

```bash
cd psx-ai-assistant
python3 -m http.server 8080
# Open http://localhost:8080
```

> ⚠️ Opening `index.html` directly via `file://` mostly works, but a local server avoids browser fetch CORS quirks.

## 🧪 Running Tests

```bash
cd psx-ai-assistant
node test/indicators.test.js
```

Covers SMA, EMA, RSI (including Wilde's method), MACD, Bollinger Bands, support/resistance, full `analyze()` snapshot, and `analyzeWeekly()`. All 11 tests passing.

---

## 🌐 Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages → Build and deployment → Source**: Deploy from a branch.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Site goes live at `https://<username>.github.io/psx-ai-assistant/`.

---

## 📊 Data Source

- **Yahoo Finance** (`query2.finance.yahoo.com`) — public chart endpoint. Works client-side for PSX (Karachi) symbols with the `.KA` suffix, and `^KSE` for the KSE-100 index. All prices in PKR.
- KSE-100 constituents are **hardcoded** in `js/stocks.js` (the index composition changes infrequently — update the list periodically from PSX official sources).
- The app caches aggressively and degrades gracefully (skeletons, retry buttons, stale-cache fallback) when Yahoo rate-limits.

---

## ⚠️ Disclaimer

**This tool is for educational and informational purposes only.** All analysis is rule-based based on historical price data and technical indicators. It does not constitute financial advice, investment recommendation, or solicitation to buy/sell securities. Past performance does not guarantee future results. Always consult a qualified financial advisor before making investment decisions.

StockSage AI is not affiliated with the Pakistan Stock Exchange, Yahoo Finance, or any financial institution.

---

Built with ❤️ for the PSX community.