/**
 * Spike 1h: SL 4–10% + fecho forçado às 30h.
 * Top 10 símbolos: MFE (máx.) e PnL/fecho às 30h.
 *
 *   node scripts/study-volume-spike-1h-sl-30h.mjs
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
const SL_LEVELS = [4, 5, 6, 7, 8, 9, 10];

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-06-01T00:00:00.000Z');
const t1 = Date.now();
const CACHE = path.join(DIR, 'cache-volume-spike-1h-jun-c100.json');
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-volume-spike-1h-sl-30h-${stamp}.json`);

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

/** Walk até 30h: MFE, fecho 30h, e se SL bate antes. */
function walk30h(bars, sig, slPct) {
  const entry = sig.entry;
  const slPx = entry * (1 - slPct / 100);
  const maxIdx = Math.min(bars.length - 1, sig.idx + HOLD_H);
  let peakHigh = entry;
  let peakIdx = sig.idx;
  let slHour = null;

  for (let i = sig.idx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    if (b.h > peakHigh) {
      peakHigh = b.h;
      peakIdx = i;
    }
    if (slHour == null && b.l <= slPx) slHour = i - sig.idx;
  }

  const end = bars[maxIdx];
  const mfePct = ((peakHigh - entry) / entry) * 100;
  const close30Pct = ((end.c - entry) / entry) * 100;
  const hoursToPeak = peakIdx - sig.idx;

  let path;
  let pnlPct;
  let exitHour;
  if (slHour != null) {
    path = 'SL';
    pnlPct = -slPct - FEE;
    exitHour = slHour;
  } else {
    path = 'TIME_30H';
    pnlPct = close30Pct - FEE;
    exitHour = maxIdx - sig.idx;
  }

  return {
    mfePct: +mfePct.toFixed(3),
    close30Pct: +close30Pct.toFixed(3),
    hoursToPeak,
    peakAt: iso(bars[peakIdx].t),
    exitAt30h: iso(end.t),
    path,
    pnlPct: +pnlPct.toFixed(3),
    exitHour,
    slHour,
    endIdx: maxIdx,
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) return { n: 0, usdt: 0, wr: 0, pf: 0, avg: 0, maxDd: 0 };
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
  return {
    n,
    wins,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : gw > 0 ? 99 : 0,
    maxDd: +maxDd.toFixed(2),
    paths,
  };
}

if (!existsSync(CACHE)) {
  console.error('Cache em falta — corre study-volume-spike-1h-jun.mjs');
  process.exit(1);
}

const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const symbols = cached.symbols || Object.keys(cached.klines || {});
const klines = cached.klines || {};

console.log('═'.repeat(80));
console.log(`Spike 1h · SL ${SL_LEVELS[0]}–${SL_LEVELS.at(-1)}% · fecho ${HOLD_H}h`);
console.log(`${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`);
console.log('═'.repeat(80));

const raw = [];
for (const sym of symbols) {
  const bars = klines[sym] || [];
  if (bars.length < VOL_LOOKBACK + HOLD_H + 5) continue;
  raw.push(...findSignals(sym, bars));
}
raw.sort((a, b) => a.entryTs - b.entryTs);

const bySl = {};
for (const sl of SL_LEVELS) {
  const trades = [];
  const busy = new Map();
  for (const sig of raw) {
    const until = busy.get(sig.symbol) || 0;
    if (sig.entryTs < until) continue;
    const bars = klines[sig.symbol];
    const w = walk30h(bars, sig, sl);
    const usdt = +((w.pnlPct * SIZE) / 100).toFixed(2);
    trades.push({
      symbol: sig.symbol,
      entryTs: sig.entryTs,
      entryAt: sig.entryAt,
      entry: sig.entry,
      pricePct: sig.pricePct,
      volRatio: sig.volRatio,
      mfePct: w.mfePct,
      close30Pct: w.close30Pct,
      hoursToPeak: w.hoursToPeak,
      peakAt: w.peakAt,
      exitAt30h: w.exitAt30h,
      path: w.path,
      pnlPct: w.pnlPct,
      usdt,
      exitHour: w.exitHour,
    });
    busy.set(sig.symbol, bars[w.endIdx].t);
  }
  const summary = summarize(trades);

  // por símbolo
  const bySym = new Map();
  for (const t of trades) {
    const cur = bySym.get(t.symbol) || {
      symbol: t.symbol,
      n: 0,
      wins: 0,
      usdt: 0,
      mfeSum: 0,
      mfeMax: -Infinity,
      close30Sum: 0,
      close30UsdtSum: 0,
    };
    cur.n++;
    cur.usdt += t.usdt;
    if (t.usdt > 0) cur.wins++;
    cur.mfeSum += t.mfePct;
    cur.mfeMax = Math.max(cur.mfeMax, t.mfePct);
    cur.close30Sum += t.close30Pct;
    cur.close30UsdtSum += (t.close30Pct * SIZE) / 100;
    bySym.set(t.symbol, cur);
  }

  const ranking = [...bySym.values()]
    .map((s) => ({
      symbol: s.symbol,
      n: s.n,
      wr: +((100 * s.wins) / s.n).toFixed(1),
      usdt: +s.usdt.toFixed(2),
      avgMfePct: +(s.mfeSum / s.n).toFixed(2),
      maxMfePct: +s.mfeMax.toFixed(2),
      avgClose30Pct: +(s.close30Sum / s.n).toFixed(2),
      // valor teórico se só fechasse às 30h sem SL
      avgClose30Usdt: +(s.close30UsdtSum / s.n).toFixed(2),
    }))
    .sort((a, b) => b.usdt - a.usdt);

  bySl[sl] = { summary, top10: ranking.slice(0, 10), worst10: [...ranking].sort((a, b) => a.usdt - b.usdt).slice(0, 10), trades };
  console.log(
    `\n── SL −${sl}% + TIME 30h ── n=${summary.n} WR=${summary.wr}% USDT=${summary.usdt >= 0 ? '+' : ''}${summary.usdt} PF=${summary.pf} DD=${summary.maxDd} ${JSON.stringify(summary.paths)}`
  );
}

// Top 10 no melhor SL (e também sem SL = só 30h para MFE/fecho)
const bestSl = SL_LEVELS.map((sl) => ({ sl, ...bySl[sl].summary })).sort((a, b) => b.usdt - a.usdt)[0];
console.log(`\nMelhor SL: −${bestSl.sl}% → +${bestSl.usdt} USDT`);

// Perfil MFE + close30 por símbolo (sem SL, só walk 30h) — top 10 por USDT no melhor SL
const refSl = bestSl.sl;
const top10 = bySl[refSl].top10;

console.log(`\n── TOP 10 símbolos (SL −${refSl}% + fecho 30h) ──`);
console.log(
  'symbol'.padEnd(16) +
    'n'.padStart(4) +
    'WR%'.padStart(7) +
    'USDT'.padStart(9) +
    'maxMFE%'.padStart(9) +
    'avgMFE%'.padStart(9) +
    'avg@30h%'.padStart(10) +
    'avg@30h$'.padStart(10)
);
for (const r of top10) {
  console.log(
    r.symbol.padEnd(16) +
      String(r.n).padStart(4) +
      String(r.wr).padStart(7) +
      ((r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)).padStart(9) +
      (('+' + r.maxMfePct.toFixed(1)).padStart(9)) +
      (('+' + r.avgMfePct.toFixed(1)).padStart(9)) +
      ((r.avgClose30Pct >= 0 ? '+' : '') + r.avgClose30Pct.toFixed(1)).padStart(10) +
      ((r.avgClose30Usdt >= 0 ? '+' : '') + r.avgClose30Usdt.toFixed(1)).padStart(10)
  );
}

// Detalhe trade-a-trade do top 10 (no melhor SL)
const topSymSet = new Set(top10.map((t) => t.symbol));
const topTrades = bySl[refSl].trades
  .filter((t) => topSymSet.has(t.symbol))
  .sort((a, b) => b.usdt - a.usdt);

console.log(`\n── Trades do top 10 (SL −${refSl}%) — máx. atingido vs fecho 30h ──`);
for (const t of topTrades.slice(0, 40)) {
  console.log(
    `${t.entryAt} ${t.symbol.padEnd(14)} path=${t.path.padEnd(9)} MFE=+${t.mfePct.toFixed(1)}% @${t.hoursToPeak}h | @30h=${t.close30Pct >= 0 ? '+' : ''}${t.close30Pct.toFixed(1)}% | PnL=${t.usdt >= 0 ? '+' : ''}${t.usdt}`
  );
}

// Tabela resumo SL
console.log('\n── Resumo SL 4–10% ──');
for (const sl of SL_LEVELS) {
  const s = bySl[sl].summary;
  console.log(
    `  SL −${String(sl).padStart(2)}%  USDT=${(s.usdt >= 0 ? '+' : '') + String(s.usdt).padStart(7)}  WR=${String(s.wr).padStart(5)}%  PF=${s.pf}  DD=${s.maxDd}  SL=${s.paths.SL || 0} TIME=${s.paths.TIME_30H || 0}`
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
        slLevels: SL_LEVELS,
        pricePctMin: PRICE_PCT,
        volMult: VOL_MULT,
        feePct: FEE,
        sizeUsdt: SIZE,
        note: 'SL 4–10% + fecho às 30h. maxMfePct = máximo high na janela 30h. avgClose30Pct = fecho da vela +30h (mesmo se SL bateu — valor teórico às 30h).',
      },
      bestSl: bestSl.sl,
      bySl: Object.fromEntries(
        SL_LEVELS.map((sl) => [
          sl,
          {
            summary: bySl[sl].summary,
            top10: bySl[sl].top10,
            worst10: bySl[sl].worst10,
          },
        ])
      ),
      top10Detail: {
        sl: refSl,
        symbols: top10,
        trades: topTrades.map((t) => ({
          symbol: t.symbol,
          entryAt: t.entryAt,
          entry: t.entry,
          path: t.path,
          mfePct: t.mfePct,
          hoursToPeak: t.hoursToPeak,
          close30Pct: t.close30Pct,
          usdt: t.usdt,
          pricePct: t.pricePct,
          volRatio: t.volRatio,
        })),
      },
    },
    null,
    2
  )
);
console.log('\nJSON', OUT);
