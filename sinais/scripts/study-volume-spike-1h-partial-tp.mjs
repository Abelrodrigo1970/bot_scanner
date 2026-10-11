/**
 * Spike 1h · SL −5% · TP parcial 50% em +10/15/20/25%
 * Restante: fecha às 30h OU em +95% (testa os dois modos; no modo 95% também corta às 30h se não atingir).
 *
 *   node scripts/study-volume-spike-1h-partial-tp.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FEE = 0.1;
const SIZE = 100;
const PRICE_PCT = 5;
const VOL_MULT = 12;
const VOL_LOOKBACK = 10;
const HOLD_H = 30;
const SL = 5;
const TP_PARTIALS = [10, 15, 20, 25];
const TP1_POS = 0.5;
const TP_RUNNER = 95;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-06-01T00:00:00.000Z');
const t1 = Date.now();
const CACHE = path.join(DIR, 'cache-volume-spike-1h-jun-c100.json');
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-volume-spike-1h-partial-tp-${stamp}.json`);

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

function findSignals(symbol, bars) {
  const signals = [];
  for (let i = VOL_LOOKBACK + 1; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.t < t0 || bar.t > t1) continue;
    const prev = bars[i - 1];
    if (!(prev.c > 0) || !(bar.c > 0) || !(bar.v > 0)) continue;
    const pricePct = ((bar.c - prev.c) / prev.c) * 100;
    if (pricePct < PRICE_PCT) continue;
    let sumV = 0;
    for (let j = i - VOL_LOOKBACK; j < i; j++) sumV += bars[j].v;
    const avgV = sumV / VOL_LOOKBACK;
    if (!(avgV > 0) || bar.v / avgV < VOL_MULT) continue;
    signals.push({
      symbol,
      entryTs: bar.t,
      entryAt: iso(bar.t),
      entry: bar.c,
      pricePct: +pricePct.toFixed(2),
      volRatio: +(bar.v / avgV).toFixed(2),
      idx: i,
    });
  }
  return signals;
}

/**
 * @param {'time30' | 'runner95'} remainderMode
 *   time30: resto fecha às 30h (ou SL)
 *   runner95: resto tenta +95%, senão fecha às 30h (ou SL)
 */
function simulatePartial(bars, sig, tp1Pct, remainderMode) {
  const entry = sig.entry;
  const slPx = entry * (1 - SL / 100);
  const tp1Px = entry * (1 + tp1Pct / 100);
  const tp2Px = entry * (1 + TP_RUNNER / 100);
  const maxIdx = Math.min(bars.length - 1, sig.idx + HOLD_H);

  let hitTp1 = false;
  let locked = 0; // % pnl before fee
  let path = 'OPEN';
  let exitIdx = maxIdx;

  for (let i = sig.idx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    const hitSl = b.l <= slPx;
    const hitTp1Now = !hitTp1 && b.h >= tp1Px;
    const hitTp2Now = hitTp1 && remainderMode === 'runner95' && b.h >= tp2Px;

    // Antes do parcial: SL e TP1 na mesma barra → SL primeiro (conservador)
    if (!hitTp1) {
      if (hitSl && hitTp1Now) {
        locked = -SL;
        path = 'SL';
        exitIdx = i;
        break;
      }
      if (hitSl) {
        locked = -SL;
        path = 'SL';
        exitIdx = i;
        break;
      }
      if (hitTp1Now) {
        locked += TP1_POS * tp1Pct;
        hitTp1 = true;
        // continua com resto
      }
      continue;
    }

    // Depois do parcial
    if (hitSl && hitTp2Now) {
      locked += (1 - TP1_POS) * -SL;
      path = 'TP1+SL';
      exitIdx = i;
      break;
    }
    if (hitSl) {
      locked += (1 - TP1_POS) * -SL;
      path = 'TP1+SL';
      exitIdx = i;
      break;
    }
    if (hitTp2Now) {
      locked += (1 - TP1_POS) * TP_RUNNER;
      path = 'TP1+TP95';
      exitIdx = i;
      break;
    }
  }

  if (path === 'OPEN') {
    const last = bars[maxIdx];
    if (!hitTp1) {
      // nunca tocou TP1: fecha tudo às 30h
      locked = ((last.c - entry) / entry) * 100;
      path = 'TIME_30H';
    } else {
      locked += (1 - TP1_POS) * (((last.c - entry) / entry) * 100);
      path = 'TP1+TIME_30H';
    }
    exitIdx = maxIdx;
  }

  const pnlPct = locked - FEE;
  return {
    path,
    pnlPct: +pnlPct.toFixed(4),
    usdt: +((pnlPct * SIZE) / 100).toFixed(2),
    hitTp1,
    exitAt: iso(bars[exitIdx].t),
    exitHour: exitIdx - sig.idx,
    endIdx: maxIdx,
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) return { n: 0, usdt: 0, wr: 0, pf: 0, avg: 0, maxDd: 0, paths: {} };
  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const gw = trades.filter((t) => t.usdt > 0).reduce((a, t) => a + t.usdt, 0);
  const gl = Math.abs(trades.filter((t) => t.usdt < 0).reduce((a, t) => a + t.usdt, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of [...trades].sort((a, b) => a.entryTs - b.entryTs)) {
    equity += t.usdt;
    if (equity > peak) peak = equity;
    maxDd = Math.max(maxDd, peak - equity);
  }
  const paths = {};
  for (const t of trades) paths[t.path] = (paths[t.path] || 0) + 1;
  const hitTp1N = trades.filter((t) => t.hitTp1).length;
  return {
    n,
    wins,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : gw > 0 ? 99 : 0,
    maxDd: +maxDd.toFixed(2),
    hitTp1N,
    hitTp1Pct: +((100 * hitTp1N) / n).toFixed(1),
    paths,
  };
}

if (!existsSync(CACHE)) {
  console.error('Cache em falta');
  process.exit(1);
}

const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const symbols = cached.symbols || Object.keys(cached.klines || {});
const klines = cached.klines || {};

console.log('═'.repeat(80));
console.log(`Spike 1h · SL −${SL}% · TP parcial 50% @ ${TP_PARTIALS.join('/')}% · resto 30h ou +${TP_RUNNER}%`);
console.log(`${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`);
console.log('═'.repeat(80));

const raw = [];
for (const sym of symbols) {
  const bars = klines[sym] || [];
  if (bars.length < VOL_LOOKBACK + HOLD_H + 5) continue;
  raw.push(...findSignals(sym, bars));
}
raw.sort((a, b) => a.entryTs - b.entryTs);

const modes = [
  { key: 'resto_30h', remainderMode: 'time30', label: 'resto @30h' },
  { key: 'resto_95_ou_30h', remainderMode: 'runner95', label: `resto +${TP_RUNNER}% senão 30h` },
];

const results = [];

for (const mode of modes) {
  for (const tp1 of TP_PARTIALS) {
    const trades = [];
    const busy = new Map();
    for (const sig of raw) {
      const until = busy.get(sig.symbol) || 0;
      if (sig.entryTs < until) continue;
      const bars = klines[sig.symbol];
      const w = simulatePartial(bars, sig, tp1, mode.remainderMode);
      trades.push({
        symbol: sig.symbol,
        entryTs: sig.entryTs,
        entryAt: sig.entryAt,
        ...w,
      });
      busy.set(sig.symbol, bars[w.endIdx].t);
    }
    const summary = summarize(trades);
    const row = {
      mode: mode.key,
      label: mode.label,
      tp1,
      sl: SL,
      tp1Pos: TP1_POS * 100,
      runner: mode.remainderMode === 'runner95' ? TP_RUNNER : null,
      holdH: HOLD_H,
      summary,
    };
    results.push(row);
    console.log(
      `\n── TP1 +${tp1}% (50%) + ${mode.label} ── n=${summary.n} WR=${summary.wr}% USDT=${summary.usdt >= 0 ? '+' : ''}${summary.usdt} PF=${summary.pf} DD=${summary.maxDd} hitTP1=${summary.hitTp1Pct}%`
    );
    console.log('  paths', summary.paths);
  }
}

results.sort((a, b) => b.summary.usdt - a.summary.usdt);
console.log('\n══ RANKING ══');
for (const r of results) {
  console.log(
    `  TP1+${String(r.tp1).padStart(2)}% | ${r.label.padEnd(28)} USDT=${(r.summary.usdt >= 0 ? '+' : '') + String(r.summary.usdt).padStart(7)} WR=${String(r.summary.wr).padStart(5)}% PF=${r.summary.pf} DD=${r.summary.maxDd}`
  );
}

// baseline: SL5 + full close 30h (no partial)
{
  const trades = [];
  const busy = new Map();
  for (const sig of raw) {
    const until = busy.get(sig.symbol) || 0;
    if (sig.entryTs < until) continue;
    const bars = klines[sig.symbol];
    const entry = sig.entry;
    const slPx = entry * (1 - SL / 100);
    const maxIdx = Math.min(bars.length - 1, sig.idx + HOLD_H);
    let path = 'TIME_30H';
    let pnlPct;
    let exitIdx = maxIdx;
    for (let i = sig.idx + 1; i <= maxIdx; i++) {
      if (bars[i].l <= slPx) {
        path = 'SL';
        pnlPct = -SL - FEE;
        exitIdx = i;
        break;
      }
    }
    if (path === 'TIME_30H') {
      pnlPct = ((bars[maxIdx].c - entry) / entry) * 100 - FEE;
    }
    trades.push({
      symbol: sig.symbol,
      entryTs: sig.entryTs,
      usdt: +((pnlPct * SIZE) / 100).toFixed(2),
      path,
      hitTp1: false,
      endIdx: maxIdx,
    });
    busy.set(sig.symbol, bars[maxIdx].t);
  }
  const summary = summarize(trades);
  console.log(
    `\n── BASELINE SL5 + full @30h ── USDT=${summary.usdt >= 0 ? '+' : ''}${summary.usdt} WR=${summary.wr}% PF=${summary.pf}`
  );
  results.push({
    mode: 'baseline_full_30h',
    label: 'baseline full @30h',
    tp1: null,
    sl: SL,
    summary,
  });
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        sl: SL,
        tpPartials: TP_PARTIALS,
        tp1PositionPct: 50,
        holdH: HOLD_H,
        runnerPct: TP_RUNNER,
        feePct: FEE,
        sizeUsdt: SIZE,
        note: 'TP parcial 50%. Resto: time30 = só 30h/SL; runner95 = +95% ou 30h/SL. Mesma barra SL+TP → SL primeiro.',
      },
      ranking: results.sort((a, b) => b.summary.usdt - a.summary.usdt),
    },
    null,
    2
  )
);
console.log('\nJSON', OUT);
