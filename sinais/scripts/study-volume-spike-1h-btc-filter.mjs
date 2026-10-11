/**
 * Spike 1h (SL −5% / TP +95% / 30h) + filtro BTC.
 *
 * Se BTC 1h cair mais de X% vs fecho anterior:
 *   A) só bloqueia novas entradas
 *   B) bloqueia entradas + fecha todos os trades abertos (fecho ao close da alt)
 *
 *   node scripts/study-volume-spike-1h-btc-filter.mjs
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
const TP = 95;
const BTC = 'BTCUSDT';
const THRESHOLDS = [0.5, 1, 1.5, 2];

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-06-01T00:00:00.000Z');
const t1 = Date.now();
const CACHE = path.join(DIR, 'cache-volume-spike-1h-jun-c100.json');
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-volume-spike-1h-btc-filter-${stamp}.json`);

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

/** Mapa ts → Δ% fecho vs fecho ant. BTC. */
function buildBtcChangeMap(btcBars) {
  const map = new Map();
  for (let i = 1; i < btcBars.length; i++) {
    const prev = btcBars[i - 1];
    const bar = btcBars[i];
    if (!(prev.c > 0)) continue;
    map.set(bar.t, ((bar.c - prev.c) / prev.c) * 100);
  }
  return map;
}

/**
 * Walk SL/TP/TIME; se btcDumpClose=true e BTC Δ% < −thr na barra i → fecha ao close alt.
 * Entrada já assume que o sinal passou o filtro de entrada.
 */
function simulate(bars, sig, btcChangeByTs, thr, forceCloseOnBtcDump) {
  const entry = sig.entry;
  const slPx = entry * (1 - SL / 100);
  const tpPx = entry * (1 + TP / 100);
  const maxIdx = Math.min(bars.length - 1, sig.idx + HOLD_H);

  for (let i = sig.idx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    const hitSl = b.l <= slPx;
    const hitTp = b.h >= tpPx;

    // Mesma barra: SL antes de TP; BTC dump avalia-se após (fecho da barra).
    if (hitSl && hitTp) {
      return { path: 'SL', pnlPct: -SL - FEE, hours: i - sig.idx, exitAt: iso(b.t) };
    }
    if (hitSl) {
      return { path: 'SL', pnlPct: -SL - FEE, hours: i - sig.idx, exitAt: iso(b.t) };
    }
    if (hitTp) {
      return { path: 'TP', pnlPct: TP - FEE, hours: i - sig.idx, exitAt: iso(b.t) };
    }

    if (forceCloseOnBtcDump) {
      const btcPct = btcChangeByTs.get(b.t);
      if (btcPct != null && btcPct < -thr) {
        const pnlPct = ((b.c - entry) / entry) * 100 - FEE;
        return {
          path: 'BTC_DUMP',
          pnlPct: +pnlPct.toFixed(4),
          hours: i - sig.idx,
          exitAt: iso(b.t),
          btcPct: +btcPct.toFixed(2),
        };
      }
    }
  }

  const last = bars[maxIdx];
  return {
    path: 'TIME',
    pnlPct: ((last.c - entry) / entry) * 100 - FEE,
    hours: maxIdx - sig.idx,
    exitAt: iso(last.t),
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) {
    return {
      n: 0,
      wins: 0,
      wr: 0,
      usdt: 0,
      avg: 0,
      pf: 0,
      maxDd: 0,
      paths: {},
      avgHours: 0,
      blockedEntries: 0,
      btcDumpCloses: 0,
    };
  }
  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const gw = trades.filter((t) => t.usdt > 0).reduce((a, t) => a + t.usdt, 0);
  const gl = Math.abs(trades.filter((t) => t.usdt < 0).reduce((a, t) => a + t.usdt, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of [...trades].sort((a, b) => a.entryTs - b.entryTs || a.exitH - b.exitH)) {
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
    btcDumpCloses: paths.BTC_DUMP || 0,
  };
}

function runMode(rawSignals, klines, btcChangeByTs, thr, mode) {
  // mode: 'off' | 'block' | 'block_close'
  const forceClose = mode === 'block_close';
  const blockEntry = mode !== 'off';
  const trades = [];
  const busy = new Map();
  let blockedEntries = 0;
  let wouldBlock = 0;

  for (const sig of rawSignals) {
    const until = busy.get(sig.symbol) || 0;
    if (sig.entryTs < until) continue;

    const btcPctAtEntry = btcChangeByTs.get(sig.entryTs);
    const dumpAtEntry = btcPctAtEntry != null && btcPctAtEntry < -thr;

    if (blockEntry && dumpAtEntry) {
      blockedEntries++;
      wouldBlock++;
      continue;
    }
    if (!blockEntry && dumpAtEntry) wouldBlock++;

    const bars = klines[sig.symbol];
    const w = simulate(bars, sig, btcChangeByTs, thr, forceClose);
    const usdt = +((w.pnlPct * SIZE) / 100).toFixed(2);
    const exitTs = bars[sig.idx + w.hours]?.t ?? sig.entryTs + w.hours * 3600000;
    trades.push({
      symbol: sig.symbol,
      entryTs: sig.entryTs,
      entryAt: sig.entryAt,
      entry: sig.entry,
      pricePct: sig.pricePct,
      volRatio: sig.volRatio,
      btcPctAtEntry: btcPctAtEntry != null ? +btcPctAtEntry.toFixed(2) : null,
      path: w.path,
      pnlPct: +w.pnlPct.toFixed(3),
      usdt,
      exitH: w.hours,
      exitAt: w.exitAt,
      btcDumpPct: w.btcPct ?? null,
    });
    busy.set(sig.symbol, exitTs + 1);
  }

  const summary = summarize(trades);
  summary.blockedEntries = blockedEntries;
  summary.wouldBlockIfOn = wouldBlock;
  summary.mode = mode;
  summary.thr = thr;
  return { summary, trades };
}

if (!existsSync(CACHE)) {
  console.error('Cache em falta — corre study-volume-spike-1h-jun.mjs');
  process.exit(1);
}

const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const symbols = cached.symbols || Object.keys(cached.klines || {});
const klines = cached.klines || {};
const btcBars = klines[BTC];
if (!btcBars?.length) {
  console.error('BTCUSDT em falta no cache');
  process.exit(1);
}

const btcChangeByTs = buildBtcChangeMap(btcBars);

console.log('═'.repeat(80));
console.log(`Spike 1h · SL${SL}/TP${TP}/${HOLD_H}h · filtro BTC dump`);
console.log(`${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`);
console.log(`BTC barras: ${btcBars.length} | limiares: −${THRESHOLDS.join('/−')}%`);
console.log('═'.repeat(80));

const raw = [];
for (const sym of symbols) {
  const bars = klines[sym] || [];
  if (bars.length < VOL_LOOKBACK + HOLD_H + 5) continue;
  raw.push(...findSignals(sym, bars));
}
raw.sort((a, b) => a.entryTs - b.entryTs);
console.log(`Sinais brutos (sem overlap): ${raw.length}`);

const baseline = runMode(raw, klines, btcChangeByTs, 1, 'off');
console.log(
  `\nBASELINE (sem filtro): n=${baseline.summary.n} WR=${baseline.summary.wr}% USDT=${baseline.summary.usdt} PF=${baseline.summary.pf} maxDd=${baseline.summary.maxDd}`
);
console.log(`  paths:`, baseline.summary.paths);
console.log(`  (entradas com BTC←1%: ${baseline.summary.wouldBlockIfOn})`);

const rows = [];
for (const thr of THRESHOLDS) {
  const block = runMode(raw, klines, btcChangeByTs, thr, 'block');
  const full = runMode(raw, klines, btcChangeByTs, thr, 'block_close');
  rows.push({ thr, block: block.summary, full: full.summary });
  console.log(`\n── BTC dump < −${thr}% ──`);
  console.log(
    `  A) só bloquear entradas: n=${block.summary.n} (−${block.summary.blockedEntries} bloq) WR=${block.summary.wr}% USDT=${block.summary.usdt} (Δ${+(block.summary.usdt - baseline.summary.usdt).toFixed(2)}) PF=${block.summary.pf} maxDd=${block.summary.maxDd}`
  );
  console.log(
    `  B) bloquear + fechar abertos: n=${full.summary.n} bloq=${full.summary.blockedEntries} BTC_DUMP=${full.summary.btcDumpCloses} WR=${full.summary.wr}% USDT=${full.summary.usdt} (Δ${+(full.summary.usdt - baseline.summary.usdt).toFixed(2)}) PF=${full.summary.pf} maxDd=${full.summary.maxDd}`
  );
  console.log(`     paths B:`, full.summary.paths);
}

// Detalhe −1%: trades que seriam bloqueados / fechados
const full1 = runMode(raw, klines, btcChangeByTs, 1, 'block_close');
const blockedDetail = [];
const busyProbe = new Map();
for (const sig of raw) {
  const until = busyProbe.get(sig.symbol) || 0;
  if (sig.entryTs < until) continue;
  const btcPct = btcChangeByTs.get(sig.entryTs);
  if (btcPct != null && btcPct < -1) {
    blockedDetail.push({
      symbol: sig.symbol,
      entryAt: sig.entryAt,
      pricePct: sig.pricePct,
      volRatio: sig.volRatio,
      btcPct: +btcPct.toFixed(2),
    });
    continue;
  }
  const bars = klines[sig.symbol];
  const w = simulate(bars, sig, btcChangeByTs, 1, true);
  const exitTs = bars[sig.idx + w.hours]?.t ?? sig.entryTs;
  busyProbe.set(sig.symbol, exitTs + 1);
}

const dumpCloses = full1.trades
  .filter((t) => t.path === 'BTC_DUMP')
  .sort((a, b) => a.entryTs - b.entryTs)
  .slice(0, 25)
  .map((t) => ({
    symbol: t.symbol,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    exitH: t.exitH,
    usdt: t.usdt,
    btcDumpPct: t.btcDumpPct,
    btcPctAtEntry: t.btcPctAtEntry,
  }));

// Contagem de horas BTC dump no período
let dumpHours = {};
for (const thr of THRESHOLDS) {
  let n = 0;
  for (const pct of btcChangeByTs.values()) if (pct < -thr) n++;
  dumpHours[thr] = n;
}

const monthly = (trades) => {
  const by = {};
  for (const t of trades) {
    const m = t.entryAt.slice(0, 7);
    if (!by[m]) by[m] = { n: 0, usdt: 0 };
    by[m].n++;
    by[m].usdt += t.usdt;
  }
  return Object.entries(by)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, v]) => ({ month: m, n: v.n, usdt: +v.usdt.toFixed(2) }));
};

const out = {
  meta: {
    from: new Date(t0).toISOString().slice(0, 10),
    to: new Date(t1).toISOString().slice(0, 10),
    exit: { sl: SL, tp: TP, holdH: HOLD_H },
    entry: { pricePctMin: PRICE_PCT, volMult: VOL_MULT, volLookback: VOL_LOOKBACK },
    btcRule:
      'BTC 1h Δ% = (close−prevClose)/prevClose. Entrada bloqueada se Δ < −thr. Fecho forçado no close da alt se durante hold BTC Δ < −thr (após checar SL/TP na mesma barra).',
    feePct: FEE,
    sizeUsdt: SIZE,
    symbols: symbols.length,
    dumpHoursInPeriod: dumpHours,
  },
  baseline: baseline.summary,
  baselineMonthly: monthly(baseline.trades),
  rows,
  filter1pct: {
    block: rows.find((r) => r.thr === 1)?.block,
    full: full1.summary,
    fullMonthly: monthly(full1.trades),
    blockedEntriesSample: blockedDetail.slice(0, 30),
    btcDumpClosesSample: dumpCloses,
  },
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n→ ${OUT}`);
