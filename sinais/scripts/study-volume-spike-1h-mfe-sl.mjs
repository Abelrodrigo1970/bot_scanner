/**
 * Volume Spike 1h — MFE até 72h + sweep SL 5–10%.
 * Entrada: +5% preço e vol ≥12× média 10 velas (mesmo setup Jun→agora).
 *
 *   node scripts/study-volume-spike-1h-mfe-sl.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FEE = 0.1;
const SIZE = 100;
const PRICE_PCT = 5;
const VOL_MULT = 12;
const VOL_LOOKBACK = 10;
const HOLD_H = 72;
const SL_LEVELS = [5, 6, 7, 8, 9, 10];
const TP_CANDIDATES = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50];

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-06-01T00:00:00.000Z');
const t1 = Date.now();
const CACHE = path.join(DIR, 'cache-volume-spike-1h-jun-c100.json');
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-volume-spike-1h-mfe-sl-${stamp}.json`);

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}
function pctile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    n: arr.length,
    mean: +mean.toFixed(2),
    p25: +pctile(s, 0.25).toFixed(2),
    p50: +pctile(s, 0.5).toFixed(2),
    p75: +pctile(s, 0.75).toFixed(2),
    p90: +pctile(s, 0.9).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    min: +s[0].toFixed(2),
  };
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
    if (!(avgV > 0)) continue;
    const volRatio = bar.v / avgV;
    if (volRatio < VOL_MULT) continue;
    signals.push({
      symbol,
      entryTs: bar.t,
      entryAt: iso(bar.t),
      entry: bar.c,
      pricePct: +pricePct.toFixed(2),
      volRatio: +volRatio.toFixed(2),
      idx: i,
    });
  }
  return signals;
}

/**
 * Walk 72h: MFE (max high), horas ao pico, MAE (min low).
 * Também: em que hora o high atingiu cada nível de TP (primeira vez).
 */
function walkMfe(bars, sig) {
  const entry = sig.entry;
  const maxIdx = Math.min(bars.length - 1, sig.idx + HOLD_H);
  let peakHigh = entry;
  let peakIdx = sig.idx;
  let troughLow = entry;
  const firstHitTp = {}; // tpPct -> hours

  for (let i = sig.idx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    const hours = i - sig.idx;
    if (b.h > peakHigh) {
      peakHigh = b.h;
      peakIdx = i;
    }
    if (b.l < troughLow) troughLow = b.l;
    const highPct = ((b.h - entry) / entry) * 100;
    for (const tp of TP_CANDIDATES) {
      if (firstHitTp[tp] == null && highPct >= tp) firstHitTp[tp] = hours;
    }
  }

  const mfePct = ((peakHigh - entry) / entry) * 100;
  const maePct = ((troughLow - entry) / entry) * 100;
  const hoursToPeak = peakIdx - sig.idx;
  const close72 = bars[maxIdx];
  const close72Pct = ((close72.c - entry) / entry) * 100;

  return {
    mfePct: +mfePct.toFixed(3),
    maePct: +maePct.toFixed(3),
    hoursToPeak,
    peakAt: iso(bars[peakIdx].t),
    close72Pct: +close72Pct.toFixed(3),
    firstHitTp,
    endIdx: maxIdx,
  };
}

/** Simula SL + TP (high/low mesma barra: SL primeiro se ambos). */
function simulate(bars, sig, slPct, tpPct) {
  const entry = sig.entry;
  const slPx = entry * (1 - slPct / 100);
  const tpPx = tpPct != null ? entry * (1 + tpPct / 100) : null;
  const maxIdx = Math.min(bars.length - 1, sig.idx + HOLD_H);

  for (let i = sig.idx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    const hitSl = b.l <= slPx;
    const hitTp = tpPx != null && b.h >= tpPx;
    if (hitSl && hitTp) {
      // conservador: SL primeiro
      return { path: 'SL', pnlPct: -slPct - FEE, hours: i - sig.idx };
    }
    if (hitSl) return { path: 'SL', pnlPct: -slPct - FEE, hours: i - sig.idx };
    if (hitTp) return { path: 'TP', pnlPct: tpPct - FEE, hours: i - sig.idx };
  }
  const last = bars[maxIdx];
  return {
    path: 'TIME',
    pnlPct: ((last.c - entry) / entry) * 100 - FEE,
    hours: maxIdx - sig.idx,
  };
}

function summarizeTrades(trades) {
  const n = trades.length;
  if (!n) return { n: 0, usdt: 0, wr: 0, pf: 0, avg: 0, maxDd: 0 };
  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const gw = trades.filter((t) => t.usdt > 0).reduce((a, t) => a + t.usdt, 0);
  const gl = Math.abs(trades.filter((t) => t.usdt < 0).reduce((a, t) => a + t.usdt, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of [...trades].sort((a, b) => a.exitH - b.exitH || a.entryTs - b.entryTs)) {
    equity += t.usdt;
    if (equity > peak) peak = equity;
    maxDd = Math.max(maxDd, peak - equity);
  }
  const paths = {};
  for (const t of trades) paths[t.path] = (paths[t.path] || 0) + 1;
  return {
    n,
    wins,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : gw > 0 ? 99 : 0,
    maxDd: +maxDd.toFixed(2),
    paths,
    avgHours: +(trades.reduce((a, t) => a + t.exitH, 0) / n).toFixed(1),
  };
}

if (!existsSync(CACHE)) {
  console.error('Cache em falta — corre primeiro study-volume-spike-1h-jun.mjs');
  process.exit(1);
}

const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const symbols = cached.symbols || Object.keys(cached.klines || {});
const klines = cached.klines || {};

console.log('═'.repeat(80));
console.log(`Spike 1h MFE≤${HOLD_H}h · SL ${SL_LEVELS.join('–')}% · TP candidatos ${TP_CANDIDATES.join('/')}`);
console.log(`${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`);
console.log('═'.repeat(80));

// Sinais 1 pos/símbolo (sem overlap até 72h após entrada — usa busy no mfe end)
const raw = [];
for (const sym of symbols) {
  const bars = klines[sym] || [];
  if (bars.length < VOL_LOOKBACK + HOLD_H + 5) continue;
  raw.push(...findSignals(sym, bars));
}
raw.sort((a, b) => a.entryTs - b.entryTs);

const signals = [];
const busy = new Map();
for (const sig of raw) {
  const until = busy.get(sig.symbol) || 0;
  if (sig.entryTs < until) continue;
  const bars = klines[sig.symbol];
  const mfe = walkMfe(bars, sig);
  signals.push({ ...sig, ...mfe });
  busy.set(sig.symbol, bars[mfe.endIdx].t);
}

console.log(`Sinais (1/símbolo, cooldown 72h): ${signals.length}`);

const mfePcts = signals.map((s) => s.mfePct);
const hours = signals.map((s) => s.hoursToPeak);
const maePcts = signals.map((s) => s.maePct);

const mfeStats = stats(mfePcts);
const hourStats = stats(hours);
const maeStats = stats(maePcts);

console.log('\n── MFE em 72h (max high vs entry) ──');
console.log(mfeStats);
console.log('\n── Horas até ao pico ──');
console.log(hourStats);
console.log('\n── MAE em 72h (min low vs entry) ──');
console.log(maeStats);

// Histogram horas ao pico (buckets)
const hourBuckets = {
  '1-2h': 0,
  '3-6h': 0,
  '7-12h': 0,
  '13-24h': 0,
  '25-48h': 0,
  '49-72h': 0,
};
for (const h of hours) {
  if (h <= 2) hourBuckets['1-2h']++;
  else if (h <= 6) hourBuckets['3-6h']++;
  else if (h <= 12) hourBuckets['7-12h']++;
  else if (h <= 24) hourBuckets['13-24h']++;
  else if (h <= 48) hourBuckets['25-48h']++;
  else hourBuckets['49-72h']++;
}
console.log('\n── Distribuição horas ao pico ──');
console.log(hourBuckets);

// % sinais que atingem cada TP antes de 72h (+ horas médias quando atingem)
const tpReach = {};
for (const tp of TP_CANDIDATES) {
  const hits = signals.filter((s) => s.firstHitTp[tp] != null);
  const hitHours = hits.map((s) => s.firstHitTp[tp]);
  tpReach[tp] = {
    n: hits.length,
    pctOfSignals: +((100 * hits.length) / signals.length).toFixed(1),
    hoursWhenHit: stats(hitHours),
  };
}
console.log('\n── Alcance de TP (high ≥ TP) em ≤72h ──');
for (const tp of TP_CANDIDATES) {
  const r = tpReach[tp];
  console.log(
    `  TP +${tp}%  ${r.pctOfSignals}% sinais  | horas p50=${r.hoursWhenHit.p50 ?? '—'} mean=${r.hoursWhenHit.mean ?? '—'}`
  );
}

// SL hit before peak?
const slBeforePeak = {};
for (const sl of SL_LEVELS) {
  let hitBeforePeak = 0;
  let peakAfterSl = 0;
  for (const s of signals) {
    const bars = klines[s.symbol];
    const slPx = s.entry * (1 - sl / 100);
    let slHour = null;
    const maxIdx = Math.min(bars.length - 1, s.idx + HOLD_H);
    for (let i = s.idx + 1; i <= maxIdx; i++) {
      if (bars[i].l <= slPx) {
        slHour = i - s.idx;
        break;
      }
    }
    if (slHour != null && slHour < s.hoursToPeak) hitBeforePeak++;
    if (slHour != null) peakAfterSl++;
  }
  slBeforePeak[sl] = {
    slHitIn72h: peakAfterSl,
    slBeforePeak: hitBeforePeak,
    pctSlBeforePeak: +((100 * hitBeforePeak) / signals.length).toFixed(1),
  };
}
console.log('\n── SL antes do pico MFE ──');
for (const sl of SL_LEVELS) {
  const r = slBeforePeak[sl];
  console.log(`  SL −${sl}%  corta pico em ${r.pctSlBeforePeak}% dos sinais (${r.slBeforePeak}/${signals.length})`);
}

// Grid SL × TP
const grid = [];
for (const sl of SL_LEVELS) {
  for (const tp of TP_CANDIDATES) {
    const trades = [];
    const busyG = new Map();
    for (const sig of raw) {
      const until = busyG.get(sig.symbol) || 0;
      if (sig.entryTs < until) continue;
      const bars = klines[sig.symbol];
      if (!bars?.length) continue;
      // need idx on raw - re-find or store
      const walk = simulate(bars, sig, sl, tp);
      const usdt = +((walk.pnlPct * SIZE) / 100).toFixed(2);
      trades.push({
        symbol: sig.symbol,
        entryTs: sig.entryTs,
        exitH: walk.hours,
        path: walk.path,
        usdt,
      });
      const endIdx = Math.min(bars.length - 1, sig.idx + walk.hours);
      busyG.set(sig.symbol, bars[endIdx].t);
    }
    const summary = summarizeTrades(trades);
    grid.push({ sl, tp, ...summary });
  }
}

grid.sort((a, b) => b.usdt - a.usdt);
console.log('\n── Top 12 combinações SL×TP (≤72h) ──');
for (const g of grid.slice(0, 12)) {
  console.log(
    `  SL${g.sl}/TP${g.tp}  n=${g.n} WR=${g.wr}% USDT=${g.usdt >= 0 ? '+' : ''}${g.usdt} PF=${g.pf} DD=${g.maxDd} avgH=${g.avgHours} ${JSON.stringify(g.paths)}`
  );
}

// Best per SL (max USDT)
const bestPerSl = SL_LEVELS.map((sl) => {
  const rows = grid.filter((g) => g.sl === sl);
  return rows.sort((a, b) => b.usdt - a.usdt)[0];
});
console.log('\n── Melhor TP por cada SL ──');
for (const g of bestPerSl) {
  console.log(
    `  SL −${g.sl}% → TP +${g.tp}%  USDT=${g.usdt >= 0 ? '+' : ''}${g.usdt} WR=${g.wr}% PF=${g.pf} paths=${JSON.stringify(g.paths)}`
  );
}

// Horas ao pico por bucket de MFE
const mfeBands = [
  { label: 'MFE <5%', min: -999, max: 5 },
  { label: 'MFE 5–10%', min: 5, max: 10 },
  { label: 'MFE 10–20%', min: 10, max: 20 },
  { label: 'MFE 20–40%', min: 20, max: 40 },
  { label: 'MFE ≥40%', min: 40, max: 9999 },
];
const mfeBandHours = mfeBands.map((b) => {
  const subset = signals.filter((s) => s.mfePct >= b.min && s.mfePct < b.max);
  return {
    label: b.label,
    n: subset.length,
    hours: stats(subset.map((s) => s.hoursToPeak)),
    mfe: stats(subset.map((s) => s.mfePct)),
  };
});
console.log('\n── Horas ao pico por banda de MFE ──');
for (const b of mfeBandHours) {
  console.log(
    `  ${b.label} n=${b.n}  horas p50=${b.hours.p50 ?? '—'} mean=${b.hours.mean ?? '—'}`
  );
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        holdH: HOLD_H,
        pricePctMin: PRICE_PCT,
        volMult: VOL_MULT,
        volLookback: VOL_LOOKBACK,
        slLevels: SL_LEVELS,
        tpCandidates: TP_CANDIDATES,
        feePct: FEE,
        sizeUsdt: SIZE,
        note: 'MFE = max high em 72h. Horas ao pico = barras 1h até high máximo. Grid SL×TP: SL primeiro se mesma barra.',
      },
      nSignals: signals.length,
      mfeStats,
      hourStats,
      maeStats,
      hourBuckets,
      tpReach,
      slBeforePeak,
      bestPerSl,
      topGrid: grid.slice(0, 20),
      mfeBandHours,
      samplePeaks: [...signals]
        .sort((a, b) => b.mfePct - a.mfePct)
        .slice(0, 15)
        .map((s) => ({
          symbol: s.symbol,
          entryAt: s.entryAt,
          mfePct: s.mfePct,
          hoursToPeak: s.hoursToPeak,
          peakAt: s.peakAt,
          maePct: s.maePct,
          pricePct: s.pricePct,
          volRatio: s.volRatio,
        })),
    },
    null,
    2
  )
);
console.log('\nJSON', OUT);
