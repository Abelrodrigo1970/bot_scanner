/**
 * rsi_qqq — sweep SL/TP na lista operacional (top 30 stocks + QQQ).
 * LONG: TP1 fixo +2%@50% · varre SL e TP2
 * SHORT: varre SL e TP · fecha no LONG
 *
 *   node scripts/study-rsi-qqq-list-sl-tp-sweep.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const H1 = 60 * 60 * 1000;
const RSI_PERIOD = 14;
const RSI_MA = 18;
const CROSS = 34;
const TP1 = 2;
const TP1_POS = 0.5;
const EMA_FAST = 20;
const EMA_SLOW = 70;
const CONCURRENCY = 8;
const WARM_MS = 40 * 24 * 3600 * 1000;

const SYMBOLS = [
  'SKHYNIXUSDT',
  'WDCUSDT',
  'CRWVUSDT',
  'SKHYUSDT',
  'NOKIAUSDT',
  'STXXUSDT',
  'PENGSTOCKUSDT',
  'MUUSDT',
  'GLWUSDT',
  'AXTIUSDT',
  'DKNGUSDT',
  'ARMUSDT',
  'POETUSDT',
  'VRTUSDT',
  'RIVNUSDT',
  'SNDKUSDT',
  'NOWUSDT',
  'RDDTUSDT',
  'ORCLUSDT',
  'HOODUSDT',
  'GOOGLUSDT',
  'CBRSUSDT',
  'ZMUSDT',
  'MRVLUSDT',
  'RKLBUSDT',
  'SHOPUSDT',
  'AAOIUSDT',
  'CIENUSDT',
  'SOFIUSDT',
  'CIFRUSDT',
  'QQQUSDT',
];

const LONG_SL_GRID = [4, 5, 6, 8];
const TP2_GRID = [5, 6, 8, 10];
const SHORT_SL_GRID = [3, 4, 5, 6];
const SHORT_TP_GRID = [4, 5, 6, 8];

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-01-01T00:00:00.000Z');
const t1 = Date.now();
const CACHE = path.join(DIR, 'cache-rsi-qqq-universe-ytd-1h.json');
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-rsi-qqq-list-sl-tp-sweep-${stamp}.json`);

function rsiSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function smaOnSeries(series, period) {
  const out = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    if (series[i] == null) continue;
    let ok = true;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (j < 0 || series[j] == null) {
        ok = false;
        break;
      }
      sum += series[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}
function emaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

async function fetchJson(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

async function fetchKlines(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard++ < 200) {
    const data = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=60&start=${cursor}&limit=1000`
    );
    const list = (data.result?.list || [])
      .map((r) => ({
        t: +r[0],
        o: +r[1],
        h: +r[2],
        l: +r[3],
        c: +r[4],
      }))
      .sort((a, b) => a.t - b.t);
    if (!list.length) break;
    for (const c of list) if (c.t >= startMs && c.t <= endMs) out.push(c);
    const last = list[list.length - 1].t;
    if (last + H1 <= cursor) break;
    cursor = last + H1;
    if (list.length < 1000) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

function simulateLong(bars, entryIdx, longSl, tp2) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 - longSl / 100);
  const tp1Px = entry * (1 + TP1 / 100);
  const tp2Px = entry * (1 + tp2 / 100);
  let rem = 1;
  let locked = 0;
  let hitTp1 = false;
  let path = 'OPEN';
  let exitT = bars[entryIdx].t;
  let exitPx = entry;
  let exitIdx = entryIdx;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.l <= slPx) {
      locked += rem * -longSl;
      rem = 0;
      path = hitTp1 ? 'TP1+SL' : 'SL';
      exitT = b.t;
      exitPx = slPx;
      exitIdx = i;
      break;
    }
    if (!hitTp1 && b.h >= tp1Px) {
      locked += TP1_POS * TP1;
      rem -= TP1_POS;
      hitTp1 = true;
    }
    if (hitTp1 && rem > 0 && b.h >= tp2Px) {
      locked += rem * tp2;
      rem = 0;
      path = 'TP1+TP2';
      exitT = b.t;
      exitPx = tp2Px;
      exitIdx = i;
      break;
    }
    exitT = b.t;
    exitPx = b.c;
    exitIdx = i;
  }
  if (rem > 0) {
    locked += rem * ((exitPx - entry) / entry) * 100;
    path = hitTp1 ? 'TP1+TIME' : 'TIME';
  }
  return { pnl: locked - FEE, path, exitT, exitIdx };
}

function simulateShort(bars, entryIdx, longSignalIdxs, shortSl, shortTp) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 + shortSl / 100);
  const tpPx = entry * (1 - shortTp / 100);

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (longSignalIdxs.has(i)) {
      return {
        pnl: ((entry - b.c) / entry) * 100 - FEE,
        path: 'FLIP_LONG',
        exitT: b.t,
        exitIdx: i,
      };
    }
    if (b.h >= slPx) {
      return { pnl: -shortSl - FEE, path: 'SL', exitT: b.t, exitIdx: i };
    }
    if (b.l <= tpPx) {
      return { pnl: shortTp - FEE, path: 'TP', exitT: b.t, exitIdx: i };
    }
  }
  const last = bars[bars.length - 1];
  return {
    pnl: ((entry - last.c) / entry) * 100 - FEE,
    path: 'TIME',
    exitT: last.t,
    exitIdx: bars.length - 1,
  };
}

function prepareSymbol(h1) {
  if (!h1 || h1.length < EMA_SLOW + RSI_PERIOD + RSI_MA + 10) return null;
  const closes = h1.map((b) => b.c);
  const rsi = rsiSeries(closes, RSI_PERIOD);
  const rsiMa = smaOnSeries(rsi, RSI_MA);
  const emaF = emaSeries(closes, EMA_FAST);
  const emaS = emaSeries(closes, EMA_SLOW);

  const longSignalIdxs = new Set();
  const longEntries = [];
  const shortEntries = [];

  for (let i = 1; i < h1.length; i++) {
    if (h1[i].t < t0 || h1[i].t > t1) continue;
    const curr = rsiMa[i];
    const prev = rsiMa[i - 1];
    if (curr != null && prev != null && prev < CROSS && curr > prev && curr >= CROSS) {
      longSignalIdxs.add(i);
      longEntries.push(i);
    }
    const ef = emaF[i];
    const efp = emaF[i - 1];
    const es = emaS[i];
    const esp = emaS[i - 1];
    if (ef != null && efp != null && es != null && esp != null && efp >= esp && ef < es) {
      shortEntries.push(i);
    }
  }

  return { h1, longSignalIdxs, longEntries, shortEntries };
}

function runCombo(prepBySym, longSl, tp2, shortSl, shortTp) {
  let usdt = 0;
  let n = 0;
  let wins = 0;
  let longUsdt = 0;
  let shortUsdt = 0;
  let longN = 0;
  let shortN = 0;

  for (const prep of Object.values(prepBySym)) {
    if (!prep) continue;
    const { h1, longSignalIdxs, longEntries, shortEntries } = prep;
    const longSet = new Set(longEntries);
    const shortSet = new Set(shortEntries);
    let busyUntil = 0;

    for (let i = 1; i < h1.length; i++) {
      const bar = h1[i];
      if (bar.t < t0 || bar.t > t1) continue;
      if (busyUntil > bar.t) continue;

      if (longSet.has(i)) {
        const walk = simulateLong(h1, i, longSl, tp2);
        const u = (walk.pnl * SIZE) / 100;
        usdt += u;
        n++;
        longN++;
        longUsdt += u;
        if (u > 0) wins++;
        busyUntil = walk.exitT;
        continue;
      }

      if (shortSet.has(i)) {
        const walk = simulateShort(h1, i, longSignalIdxs, shortSl, shortTp);
        const u = (walk.pnl * SIZE) / 100;
        usdt += u;
        n++;
        shortN++;
        shortUsdt += u;
        if (u > 0) wins++;
        if (walk.path === 'FLIP_LONG' && walk.exitIdx >= 0) {
          const longWalk = simulateLong(h1, walk.exitIdx, longSl, tp2);
          const lu = (longWalk.pnl * SIZE) / 100;
          usdt += lu;
          n++;
          longN++;
          longUsdt += lu;
          if (lu > 0) wins++;
          busyUntil = longWalk.exitT;
        } else {
          busyUntil = walk.exitT;
        }
      }
    }
  }

  return {
    longSl,
    tp2,
    shortSl,
    shortTp,
    n,
    wins,
    wr: n ? +((100 * wins) / n).toFixed(1) : 0,
    usdt: +usdt.toFixed(2),
    avg: n ? +(usdt / n).toFixed(2) : 0,
    longN,
    shortN,
    longUsdt: +longUsdt.toFixed(2),
    shortUsdt: +shortUsdt.toFixed(2),
  };
}

console.log('═'.repeat(80));
console.log(
  `rsi_qqq list SL/TP sweep · ${SYMBOLS.length} símbolos · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
);
console.log(
  `LONG SL ${LONG_SL_GRID.join('/')} · TP2 ${TP2_GRID.join('/')} (TP1 ${TP1}%@50%) | SHORT SL ${SHORT_SL_GRID.join('/')} · TP ${SHORT_TP_GRID.join('/')}`
);
console.log('═'.repeat(80));

let klinesBySym = {};
if (existsSync(CACHE)) {
  try {
    const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
    klinesBySym = cached.klines || {};
    console.log(`Cache: ${Object.keys(klinesBySym).length} símbolos`);
  } catch {
    /* ignore */
  }
}

const missing = SYMBOLS.filter((s) => !klinesBySym[s] || klinesBySym[s].length < 100);
console.log(`Klines em falta: ${missing.length}`);
if (missing.length) {
  let done = 0;
  await mapPool(missing, CONCURRENCY, async (sym) => {
    try {
      klinesBySym[sym] = await fetchKlines(sym, t0 - WARM_MS, t1);
    } catch (e) {
      console.warn(`fail ${sym}: ${e.message}`);
      klinesBySym[sym] = [];
    }
    done++;
    if (done % 10 === 0 || done === missing.length) console.log(`  klines ${done}/${missing.length}`);
  });
  writeFileSync(
    CACHE,
    JSON.stringify({
      meta: { from: new Date(t0).toISOString().slice(0, 10), to: new Date(t1).toISOString() },
      klines: klinesBySym,
    })
  );
}

console.log('A preparar indicadores…');
const prepBySym = {};
for (const sym of SYMBOLS) {
  prepBySym[sym] = prepareSymbol(klinesBySym[sym] || []);
}
const ready = Object.values(prepBySym).filter(Boolean).length;
console.log(`Símbolos prontos: ${ready}/${SYMBOLS.length}`);

const combos = [];
for (const longSl of LONG_SL_GRID) {
  for (const tp2 of TP2_GRID) {
    for (const shortSl of SHORT_SL_GRID) {
      for (const shortTp of SHORT_TP_GRID) {
        combos.push({ longSl, tp2, shortSl, shortTp });
      }
    }
  }
}

console.log(`A simular ${combos.length} combinações…`);
const rows = combos.map((c) => runCombo(prepBySym, c.longSl, c.tp2, c.shortSl, c.shortTp));
rows.sort((a, b) => b.usdt - a.usdt);

const baseline = rows.find((r) => r.longSl === 4 && r.tp2 === 5 && r.shortSl === 3 && r.shortTp === 4);
const best = rows[0];

console.log('\n── BASELINE (L−4 / TP2+5 / S+3 / TP−4) ──');
if (baseline) {
  console.log(
    `n=${baseline.n} WR=${baseline.wr}% USDT=${baseline.usdt >= 0 ? '+' : ''}${baseline.usdt} LONG=${baseline.longUsdt} SHORT=${baseline.shortUsdt}`
  );
}

console.log('\n── TOP 20 COMBOS ──');
console.log(
  '#'.padStart(3),
  'LSL'.padStart(4),
  'TP2'.padStart(4),
  'SSL'.padStart(4),
  'STP'.padStart(4),
  'n'.padStart(5),
  'WR%'.padStart(6),
  'LONG'.padStart(8),
  'SHORT'.padStart(8),
  'USDT'.padStart(9)
);
for (const [i, r] of rows.slice(0, 20).entries()) {
  console.log(
    String(i + 1).padStart(3),
    String(r.longSl).padStart(4),
    String(r.tp2).padStart(4),
    String(r.shortSl).padStart(4),
    String(r.shortTp).padStart(4),
    String(r.n).padStart(5),
    r.wr.toFixed(1).padStart(6),
    ((r.longUsdt >= 0 ? '+' : '') + r.longUsdt.toFixed(1)).padStart(8),
    ((r.shortUsdt >= 0 ? '+' : '') + r.shortUsdt.toFixed(1)).padStart(8),
    ((r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)).padStart(9)
  );
}

console.log(
  `\nMelhor: L−${best.longSl}% TP2+${best.tp2}% | S+${best.shortSl}% TP−${best.shortTp}% → USDT=${best.usdt >= 0 ? '+' : ''}${best.usdt} (Δ vs base ${baseline ? ((best.usdt - baseline.usdt) >= 0 ? '+' : '') + (best.usdt - baseline.usdt).toFixed(1) : 'n/a'})`
);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        symbols: SYMBOLS,
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        grids: {
          longSl: LONG_SL_GRID,
          tp2: TP2_GRID,
          shortSl: SHORT_SL_GRID,
          shortTp: SHORT_TP_GRID,
          tp1: TP1,
        },
        feePct: FEE,
        sizeUsdt: SIZE,
      },
      baseline: baseline || null,
      best,
      top20: rows.slice(0, 20),
      ranking: rows,
    },
    null,
    2
  )
);
console.log('JSON', OUT);
