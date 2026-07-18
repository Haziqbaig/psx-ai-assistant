/**
 * ui.js — Reusable UI helpers & components for StockSage AI.
 * Professional financial terminal aesthetic.
 */
const UI = (() => {
  const CUR_SYM = { usd: '$', eur: '€', pkr: '₨' };

  /** Format a number as PKR. */
  function money(v, cur = 'pkr', opts = {}) {
    if (v == null || isNaN(v)) return '—';
    const s = CUR_SYM[cur] || '₨';
    const abs = Math.abs(v);
    if (opts.compact || abs >= 1e9) {
      if (abs >= 1e12) return s + (v / 1e12).toFixed(2) + 'T';
      if (abs >= 1e9) return s + (v / 1e9).toFixed(2) + 'B';
      if (abs >= 1e6) return s + (v / 1e6).toFixed(2) + 'M';
      if (abs >= 1e3) return s + (v / 1e3).toFixed(1) + 'K';
    }
    if (abs >= 1000) return s + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (abs >= 1) return s + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs === 0) return s + '0';
    return s + v.toPrecision(3);
  }

  /** Signed percentage with color class. */
  function pct(v) {
    if (v == null || isNaN(v)) return '<span class="text-dim">—</span>';
    const cls = v >= 0 ? 'text-emerald-400' : 'text-rose-400';
    return `<span class="${cls}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
  }

  /** Rating badge with themed colors. */
  function ratingBadge(rating, small = false) {
    const map = {
      'Strong Buy': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      'Buy': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      'Hold': 'bg-amber-500/10 text-amber-300 border-amber-500/25',
      'Reduce': 'bg-orange-500/10 text-orange-300 border-orange-500/25',
      'Sell': 'bg-rose-500/10 text-rose-300 border-rose-500/25',
      'Strong Sell': 'bg-rose-500/15 text-rose-300 border-rose-500/35',
    };
    const cls = map[rating] || 'bg-slate-500/10 text-slate-300 border-slate-500/25';
    return `<span class="inline-block border rounded-lg font-medium ${small ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'} ${cls}">${rating}</span>`;
  }

  /** Skeleton block helpers. */
  function skeleton(h = 'h-5', w = 'w-full') { return `<div class="skeleton ${h} ${w}"></div>`; }
  function skeletonCard(lines = 3) {
    return `<div class="glass p-5 space-y-3">${Array.from({length: lines}, (_, i) =>
      skeleton('h-4', i === 0 ? 'w-1/3' : 'w-full')).join('')}</div>`;
  }

  /** Error card with retry hook. */
  function errorCard(msg, retryFn) {
    return `<div class="glass p-6 text-center space-y-3">
      <div class="text-rose-400 text-sm">⚠️ ${msg}</div>
      <button onclick="${retryFn}" class="px-4 py-2 rounded-lg text-sm bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition font-medium">Retry</button>
    </div>`;
  }

  /** Toast notification. */
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  /** Trading hours clock component. */
  function tradingClock() {
    const now = new Date();
    // Convert to PKT (UTC+5)
    const pktOffset = 5 * 60;
    const localOffset = now.getTimezoneOffset();
    const pktTime = new Date(now.getTime() + (pktOffset + localOffset) * 60000);
    const day = pktTime.getDay(); // 0=Sun ... 6=Sat
    const hours = pktTime.getHours();
    const minutes = pktTime.getMinutes();
    const timeStr = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;

    // PSX trading hours: Mon-Thu 9:30-15:30, Fri 9:30-12:30, Sat-Sun closed
    let status, statusClass;
    const isFri = day === 5;
    const isWeekend = day === 0 || day === 6; // Sun or Sat
    const marketOpen = 9 * 60 + 30;
    const marketCloseMonThu = 15 * 60 + 30;
    const marketCloseFri = 12 * 60 + 30;
    const currentMin = hours * 60 + minutes;

    if (isWeekend) {
      status = 'Market Closed (Weekend)';
      statusClass = 'text-dim';
    } else if (isFri) {
      if (currentMin < marketOpen) { status = 'Pre-Market (Opens 9:30)'; statusClass = 'text-amber-400'; }
      else if (currentMin < marketCloseFri) { status = 'Market Open'; statusClass = 'text-emerald-400'; }
      else { status = 'Market Closed'; statusClass = 'text-dim'; }
    } else {
      if (currentMin < marketOpen) { status = 'Pre-Market (Opens 9:30)'; statusClass = 'text-amber-400'; }
      else if (currentMin < marketCloseMonThu) { status = 'Market Open'; statusClass = 'text-emerald-400'; }
      else { status = 'Market Closed'; statusClass = 'text-dim'; }
    }

    const dotClass = status === 'Market Open' ? 'live-dot' : 'w-[7px] h-[7px] rounded-full bg-slate-500 inline-block';
    return `<span class="${dotClass}"></span> <span class="${statusClass} text-xs font-medium">${status}</span> <span class="text-dim text-xs ml-1">${timeStr} PKT</span>`;
  }

  /** Upsert the trading clock in the DOM. */
  function updateTradingClock() {
    const el = document.getElementById('tradingClock');
    if (el) el.innerHTML = tradingClock();
  }

  return { money, pct, ratingBadge, skeleton, skeletonCard, errorCard, toast, tradingClock, updateTradingClock, CUR_SYM };
})();