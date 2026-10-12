/**
 * EMA70 1h · Scanner 1 · LONG + SHORT · TP parcial + SL
 *
 * Universo: Scanner 1 (fecho 1d > EMA70, top N por |dist|)
 * TF: 1h
 * LONG:  fecho cruza acima da EMA70 1h
 * SHORT: fecho cruza abaixo da EMA70 1h
 * SL ±5%
 * TP1 sweep 25 / 20 / 15% com 50% da posição
 * Resto: sai no cruzamento oposto da EMA70 1h (ou SL)
 *
 *   node scripts/study-ema70-1h-s1-partial.mjs
 *   node scripts/study-ema70-1h-s1-partial.mjs --days=90 --top=50
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FEE = 0.1; // por lado
const SIZE = 100;
const EMA_PERIOD = 70;
const SL_PCT = 5;
const TP1_LEVELS = [25, 20, 15];
const TP1_POS = 0.5;
const SNAP_MS = 4 * 3600_000;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const daysArg = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] || 90);
const TOP_N = Number(process.argv.find((a) => a.startsWith('--top='))?.split('=')[1] || 50);

function resolveCache() {
  const preferred = [
    path.join(DIR, `cache-strategies-universe-fit-${daysArg}d-c100.json`),
    path.join(DIR, 'cache-strategies-universe-fit-90d-c100.json'),
    path.join(DIR, 'cache-strategies-universe-fit-30d-c100.json'),
  ];
  for (const p of preferred) if (existsSync(p)) return p;
  return preferred[0];
}
const CACHE = resolveCache();
const stamp = `${daysArg}d-top${TOP_N}`;
const OUT = path.join(DIR, `out-ema70-1h-s1-partial-tp-sweep-${stamp}.json`);

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function findIdxAtOrBefore(candles, t) {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function alignDown(t, step) {
  return Math.floor(t / step) * step;
}

/** Scanner 1: fecho 1d > EMA70, top N por |distância|. Snaps a cada 4h. */
function buildS1Snaps(d1BySym, startMs, endMs) {
  const snaps = new Map();
  const ema70 = new Map();
  for (const [sym, bars] of d1BySym) {
    ema70.set(
      sym,
      emaSeries(
        bars.map((b) => b.c),
        EMA_PERIOD
      )
    );
  }
  const from = alignDown(startMs, SNAP_MS);
  for (let t = from; t <= endMs; t += SNAP_MS) {
    const rows = [];
    for (const [sym, d1] of d1BySym) {
      const i = findIdxAtOrBefore(d1, t);
      if (i < 0) continue;
      const ema = ema70.get(sym)?.[i];
      const c = d1[i].c;
      if (!(ema != null && ema > 0 && c > ema)) continue;
      rows.push({ sym, abs: Math.abs(((c - ema) / ema) * 100) });
    }
    rows.sort((a, b) => b.abs - a.abs);
    snaps.set(t, new Set(rows.slice(0, TOP_N).map((r) => r.sym)));
  }
  return snaps;
}

function inS1(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set ? set.has(sym) : false;
}

/**
 * Walk posição aberta a partir de entryIdx+1.
 * side: 'LONG' | 'SHORT'
 * Sai: SL, TP1 parcial + resto (SL ou flip EMA70), ou EOD.
 */
function walk(bars, ema, entryIdx, entry, side, tp1Pct) {
  const isLong = side === 'LONG';
  const slPx = isLong ? entry * (1 - SL_PCT / 100) : entry * (1 + SL_PCT / 100);
  const tp1Px = isLong ? entry * (1 + tp1Pct / 100) : entry * (1 - tp1Pct / 100);

  let hitTp1 = false;
  let locked = 0; // % bruto ponderado (antes de fees)
  let path = 'OPEN';
  let exitIdx = bars.length - 1;
  let exitPx = bars[exitIdx].c;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    const e = ema[i];
    const prevE = ema[i - 1];
    const hitSl = isLong ? b.l <= slPx : b.h >= slPx;
    const hitTp1Now = !hitTp1 && (isLong ? b.h >= tp1Px : b.l <= tp1Px);

    // Flip EMA: fecho cruza para o lado oposto
    const flip =
      e != null &&
      prevE != null &&
      (isLong
        ? bars[i - 1].c >= prevE && b.c < e
        : bars[i - 1].c <= prevE && b.c > e);

    if (!hitTp1) {
      // Conservador: SL antes de TP na mesma barra
      if (hitSl && hitTp1Now) {
        locked = -SL_PCT;
        path = 'SL';
        exitIdx = i;
        exitPx = slPx;
        break;
      }
      if (hitSl) {
        locked = -SL_PCT;
        path = 'SL';
        exitIdx = i;
        exitPx = slPx;
        break;
      }
      if (hitTp1Now) {
        locked += TP1_POS * tp1Pct;
        hitTp1 = true;
        // continua com resto; flip na mesma barra após TP1
        if (flip) {
          const remPct = isLong
            ? ((b.c - entry) / entry) * 100
            : ((entry - b.c) / entry) * 100;
          locked += (1 - TP1_POS) * remPct;
          path = 'TP1+EMA_FLIP';
          exitIdx = i;
          exitPx = b.c;
          break;
        }
        continue;
      }
      if (flip) {
        const closePct = isLong
          ? ((b.c - entry) / entry) * 100
          : ((entry - b.c) / entry) * 100;
        locked = closePct;
        path = 'EMA_FLIP';
        exitIdx = i;
        exitPx = b.c;
        break;
      }
      continue;
    }

    // Depois do parcial
    if (hitSl) {
      locked += (1 - TP1_POS) * -SL_PCT;
      path = 'TP1+SL';
      exitIdx = i;
      exitPx = slPx;
      break;
    }
    if (flip) {
      const remPct = isLong
        ? ((b.c - entry) / entry) * 100
        : ((entry - b.c) / entry) * 100;
      locked += (1 - TP1_POS) * remPct;
      path = 'TP1+EMA_FLIP';
      exitIdx = i;
      exitPx = b.c;
      break;
    }
  }

  if (path === 'OPEN') {
    const last = bars[bars.length - 1];
    const closePct = isLong
      ? ((last.c - entry) / entry) * 100
      : ((entry - last.c) / entry) * 100;
    if (!hitTp1) {
      locked = closePct;
      path = 'EOD';
    } else {
      locked += (1 - TP1_POS) * closePct;
      path = 'TP1+EOD';
    }
    exitIdx = bars.length - 1;
    exitPx = last.c;
  }

  const pnlPct = locked - FEE * 2;
  return {
    path,
    hitTp1,
    pnlPct: +pnlPct.toFixed(4),
    usdt: +((pnlPct * SIZE) / 100).toFixed(2),
    exitIdx,
    exitAt: iso(bars[exitIdx].t),
    exitTs: bars[exitIdx].t,
    exit: +exitPx.toFixed(8),
    hours: exitIdx - entryIdx,
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) {
    return { n: 0, wins: 0, wr: 0, usdt: 0, avg: 0, pf: 0, maxDd: 0, paths: {} };
  }
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const gw = trades.filter((t) => t.usdt > 0).reduce((a, t) => a + t.usdt, 0);
  const gl = Math.abs(trades.filter((t) => t.usdt < 0).reduce((a, t) => a + t.usdt, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    equity += t.usdt;
    if (equity > peak) peak = equity;
    maxDd = Math.max(maxDd, peak - equity);
  }
  const paths = {};
  for (const t of trades) paths[t.path] = (paths[t.path] || 0) + 1;
  const hours = trades.map((t) => t.hours).sort((a, b) => a - b);
  const m = Math.floor(hours.length / 2);
  const medHours = hours.length % 2 ? hours[m] : +((hours[m - 1] + hours[m]) / 2).toFixed(1);
  return {
    n,
    wins,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : gw > 0 ? 99 : 0,
    maxDd: +maxDd.toFixed(2),
    avgHours: +(trades.reduce((a, t) => a + t.hours, 0) / n).toFixed(1),
    medHours,
    hitTp1N: trades.filter((t) => t.hitTp1).length,
    hitTp1Pct: +((100 * trades.filter((t) => t.hitTp1).length) / n).toFixed(1),
    paths,
  };
}

function monthly(trades) {
  const by = {};
  for (const t of trades) {
    const m = t.entryAt.slice(0, 7);
    if (!by[m]) by[m] = { n: 0, usdt: 0, wins: 0 };
    by[m].n++;
    by[m].usdt += t.usdt;
    if (t.usdt > 0) by[m].wins++;
  }
  return Object.entries(by)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, v]) => ({
      month: m,
      n: v.n,
      usdt: +v.usdt.toFixed(2),
      wr: +((100 * v.wins) / v.n).toFixed(1),
    }));
}

function bySymbol(trades) {
  const by = {};
  for (const t of trades) {
    if (!by[t.symbol]) by[t.symbol] = { n: 0, usdt: 0, wins: 0 };
    by[t.symbol].n++;
    by[t.symbol].usdt += t.usdt;
    if (t.usdt > 0) by[t.symbol].wins++;
  }
  return Object.entries(by)
    .map(([symbol, v]) => ({
      symbol,
      n: v.n,
      usdt: +v.usdt.toFixed(2),
      wr: +((100 * v.wins) / v.n).toFixed(1),
    }))
    .sort((a, b) => b.usdt - a.usdt);
}

if (!existsSync(CACHE)) {
  console.error(`Cache em falta: ${CACHE}`);
  process.exit(1);
}

const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const h1BySym = new Map(Object.entries(cached.h1BySym || {}));
const d1BySym = new Map(Object.entries(cached.d1BySym || {}));

let maxT = 0;
let minT = Infinity;
for (const bars of h1BySym.values()) {
  if (!bars.length) continue;
  minT = Math.min(minT, bars[0].t);
  maxT = Math.max(maxT, bars[bars.length - 1].t);
}
const t1 = maxT;
const t0 = Math.max(minT, t1 - daysArg * 86400_000);

console.log(`Cache: ${CACHE}`);
console.log(`1h=${h1BySym.size} 1d=${d1BySym.size}`);
console.log(`Janela: ${iso(t0)} → ${iso(t1)} (${daysArg}d) · S1 top ${TOP_N}`);

const snaps = buildS1Snaps(d1BySym, t0, t1);

function runForTp(tp1Pct) {
  const trades = [];
  for (const [sym, bars] of h1BySym) {
    if (!bars || bars.length < EMA_PERIOD + 5) continue;
    if (!d1BySym.has(sym)) continue;

    const ema = emaSeries(
      bars.map((b) => b.c),
      EMA_PERIOD
    );
    let busyUntil = -1;

    for (let i = 1; i < bars.length; i++) {
      if (bars[i].t < t0 || bars[i].t > t1) continue;
      if (i <= busyUntil) continue;
      if (ema[i] == null || ema[i - 1] == null) continue;
      if (!inS1(snaps, bars[i].t, sym)) continue;

      const prev = bars[i - 1];
      const curr = bars[i];
      const crossUp = prev.c <= ema[i - 1] && curr.c > ema[i];
      const crossDn = prev.c >= ema[i - 1] && curr.c < ema[i];
      if (!crossUp && !crossDn) continue;

      const side = crossUp ? 'LONG' : 'SHORT';
      const res = walk(bars, ema, i, curr.c, side, tp1Pct);
      trades.push({
        symbol: sym,
        side,
        entryAt: iso(curr.t),
        entryTs: curr.t,
        entry: curr.c,
        entryEma: +ema[i].toFixed(6),
        ...res,
      });
      busyUntil = res.exitIdx;
    }
  }
  return trades;
}

console.log('═'.repeat(72));
console.log(
  `EMA70 1h · S1 top ${TOP_N} · SL ±${SL_PCT}% · TP1 sweep ${TP1_LEVELS.join('/')}% @ ${TP1_POS * 100}% · resto EMA flip`
);
console.log(`${iso(t0)} → ${iso(t1)}`);
console.log('═'.repeat(72));

const results = [];
for (const tp1Pct of TP1_LEVELS) {
  const trades = runForTp(tp1Pct);
  const summary = summarize(trades);
  const longs = trades.filter((t) => t.side === 'LONG');
  const shorts = trades.filter((t) => t.side === 'SHORT');
  const sumL = summarize(longs);
  const sumS = summarize(shorts);
  const monthlyRows = monthly(trades);
  const symRows = bySymbol(trades);

  console.log(
    `\nTP1 ${tp1Pct}%  ALL n=${summary.n} WR=${summary.wr}% USDT=${summary.usdt} PF=${summary.pf} maxDd=${summary.maxDd} TP1%=${summary.hitTp1Pct}`
  );
  console.log(
    `         LONG n=${sumL.n} WR=${sumL.wr}% USDT=${sumL.usdt} PF=${sumL.pf} | SHORT n=${sumS.n} WR=${sumS.wr}% USDT=${sumS.usdt} PF=${sumS.pf}`
  );
  console.log('         paths', summary.paths);

  results.push({
    tp1Pct,
    summary,
    long: sumL,
    short: sumS,
    monthly: monthlyRows,
    bySymbol: symRows.slice(0, 15),
    worstSymbols: symRows.slice(-5).reverse(),
    best: [...trades].sort((a, b) => b.usdt - a.usdt).slice(0, 8),
    worst: [...trades].sort((a, b) => a.usdt - b.usdt).slice(0, 8),
  });
}

const best = [...results].sort((a, b) => b.summary.usdt - a.summary.usdt)[0];
console.log(`\n★ Melhor ALL USDT: TP1 ${best.tp1Pct}% → ${best.summary.usdt}`);
console.log(
  `★ Melhor LONG: TP1 ${[...results].sort((a, b) => b.long.usdt - a.long.usdt)[0].tp1Pct}%`
);

const out = {
  meta: {
    universe: `Scanner 1 — EMA70 1d top ${TOP_N}`,
    timeframe: '1h',
    from: new Date(t0).toISOString().slice(0, 10),
    to: new Date(t1).toISOString().slice(0, 10),
    days: daysArg,
    topN: TOP_N,
    entry: 'close cross EMA70 1h (LONG↑ / SHORT↓) while in S1',
    slPct: SL_PCT,
    tp1Levels: TP1_LEVELS,
    tp1Pos: TP1_POS,
    remainder: 'EMA70 1h opposite cross or SL',
    feePctPerSide: FEE,
    sizeUsdt: SIZE,
    cache: path.basename(CACHE),
  },
  results,
  bestTp1: best.tp1Pct,
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n→ ${OUT}`);
