/**
 * rsi_qqq YTD — LONG (RSI SMA ↑34) + SHORT (EMA20↓EMA70).
 * SHORT: SL +3% / TP −4% / fecha no LONG.
 *   node scripts/study-rsi-qqq-long-short-ytd.mjs
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BYBIT = 'https://api.bybit.nl';
const SYMBOL = 'QQQUSDT';
const FEE = 0.1;
const SIZE = 100;
const H1 = 60 * 60 * 1000;
const RSI_PERIOD = 14;
const RSI_MA = 18;
const CROSS = 34;
const LONG_SL = 4;
const TP1 = 2;
const TP1_POS = 0.5;
const TP2 = 5;
const EMA_FAST = 20;
const EMA_SLOW = 70;
const SHORT_SL = 3;
const SHORT_TP = 4;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-01-01T00:00:00.000Z');

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}
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
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
}

async function fetchKlines(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard++ < 200) {
    const data = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&start=${cursor}&limit=1000`
    );
    const list = ((data.result?.list || []) || [])
      .map((r) => ({
        t: +r[0],
        o: +r[1],
        h: +r[2],
        l: +r[3],
        c: +r[4],
        v: +(r[5] ?? 0),
      }))
      .sort((a, b) => a.t - b.t);
    if (!list.length) break;
    for (const c of list) if (c.t >= startMs && c.t <= endMs) out.push(c);
    const last = list[list.length - 1].t;
    if (last + H1 <= cursor) break;
    cursor = last + H1;
    if (list.length < 1000) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

function simulateLong(bars, entryIdx) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 - LONG_SL / 100);
  const tp1Px = entry * (1 + TP1 / 100);
  const tp2Px = entry * (1 + TP2 / 100);
  let rem = 1;
  let locked = 0;
  let hitTp1 = false;
  let path = 'OPEN';
  let exitT = bars[entryIdx].t;
  let exitPx = entry;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.l <= slPx) {
      locked += rem * -LONG_SL;
      rem = 0;
      path = hitTp1 ? 'TP1+SL' : 'SL';
      exitT = b.t;
      exitPx = slPx;
      break;
    }
    if (!hitTp1 && b.h >= tp1Px) {
      locked += TP1_POS * TP1;
      rem -= TP1_POS;
      hitTp1 = true;
    }
    if (hitTp1 && rem > 0 && b.h >= tp2Px) {
      locked += rem * TP2;
      rem = 0;
      path = 'TP1+TP2';
      exitT = b.t;
      exitPx = tp2Px;
      break;
    }
    exitT = b.t;
    exitPx = b.c;
  }
  if (rem > 0) {
    locked += rem * ((exitPx - entry) / entry) * 100;
    path = hitTp1 ? 'TP1+TIME' : 'TIME';
  }
  return { pnl: locked - FEE, path, exitT, exitIdx: bars.findIndex((b) => b.t === exitT) };
}

function simulateShort(bars, entryIdx, longSignalIdxs) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 + SHORT_SL / 100);
  const tpPx = entry * (1 - SHORT_TP / 100);
  let path = 'OPEN';
  let exitT = bars[entryIdx].t;
  let exitPx = entry;
  let pnlPct = 0;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    // Fecha se LONG dispara nesta barra (após entrada)
    if (longSignalIdxs.has(i)) {
      const mtm = ((entry - b.c) / entry) * 100;
      pnlPct = mtm - FEE;
      path = 'FLIP_LONG';
      exitT = b.t;
      exitPx = b.c;
      return { pnl: pnlPct, path, exitT, exitIdx: i };
    }
    if (b.h >= slPx) {
      pnlPct = -SHORT_SL - FEE;
      path = 'SL';
      exitT = b.t;
      exitPx = slPx;
      return { pnl: pnlPct, path, exitT, exitIdx: i };
    }
    if (b.l <= tpPx) {
      pnlPct = SHORT_TP - FEE;
      path = 'TP';
      exitT = b.t;
      exitPx = tpPx;
      return { pnl: pnlPct, path, exitT, exitIdx: i };
    }
    exitT = b.t;
    exitPx = b.c;
  }
  pnlPct = ((entry - exitPx) / entry) * 100 - FEE;
  return {
    pnl: pnlPct,
    path: 'TIME',
    exitT,
    exitIdx: bars.findIndex((b) => b.t === exitT),
  };
}

const t1 = Date.now();
console.log('═'.repeat(80));
console.log(
  `rsi_qqq LONG+SHORT YTD · ${SYMBOL} · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
);
console.log(
  `LONG RSI${RSI_PERIOD} SMA${RSI_MA} ↑${CROSS} SL −${LONG_SL}% TP ${TP1}%@50%+${TP2}%@50% | SHORT EMA${EMA_FAST}↓${EMA_SLOW} SL +${SHORT_SL}% TP −${SHORT_TP}% | fecha no LONG`
);
console.log('═'.repeat(80));

console.log('A obter 1h…');
const h1 = await fetchKlines(SYMBOL, '60', t0 - 40 * 24 * 3600 * 1000, t1);
console.log(`Velas 1h: ${h1.length}`);
const closes = h1.map((b) => b.c);
const rsi = rsiSeries(closes, RSI_PERIOD);
const rsiMa = smaOnSeries(rsi, RSI_MA);
const emaF = emaSeries(closes, EMA_FAST);
const emaS = emaSeries(closes, EMA_SLOW);

// Pré-calcular índices de sinais LONG (para flip do short)
const longSignalIdxs = new Set();
for (let i = 1; i < h1.length; i++) {
  if (h1[i].t < t0 || h1[i].t > t1) continue;
  const curr = rsiMa[i];
  const prev = rsiMa[i - 1];
  if (curr == null || prev == null) continue;
  if (prev < CROSS && curr > prev && curr >= CROSS) longSignalIdxs.add(i);
}

const trades = [];
let busyUntil = 0;
let busySide = null;

for (let i = 1; i < h1.length; i++) {
  const bar = h1[i];
  if (bar.t < t0 || bar.t > t1) continue;
  if (busyUntil > bar.t) continue;

  const curr = rsiMa[i];
  const prev = rsiMa[i - 1];
  const longSig =
    curr != null &&
    prev != null &&
    prev < CROSS &&
    curr > prev &&
    curr >= CROSS;

  const ef = emaF[i];
  const efp = emaF[i - 1];
  const es = emaS[i];
  const esp = emaS[i - 1];
  const shortSig =
    ef != null &&
    efp != null &&
    es != null &&
    esp != null &&
    efp >= esp &&
    ef < es;

  // Prioridade LONG se ambos
  if (longSig) {
    const walk = simulateLong(h1, i);
    const usdt = (walk.pnl * SIZE) / 100;
    trades.push({
      side: 'LONG',
      entryAt: iso(bar.t),
      exitAt: iso(walk.exitT),
      path: walk.path,
      usdt: +usdt.toFixed(2),
      pnlPct: +walk.pnl.toFixed(3),
    });
    busyUntil = walk.exitT;
    busySide = 'LONG';
    continue;
  }

  if (shortSig) {
    const walk = simulateShort(h1, i, longSignalIdxs);
    const usdt = (walk.pnl * SIZE) / 100;
    trades.push({
      side: 'SHORT',
      entryAt: iso(bar.t),
      exitAt: iso(walk.exitT),
      path: walk.path,
      usdt: +usdt.toFixed(2),
      pnlPct: +walk.pnl.toFixed(3),
    });
    // Se fechou por LONG, entra LONG na mesma barra
    if (walk.path === 'FLIP_LONG' && walk.exitIdx >= 0) {
      const longWalk = simulateLong(h1, walk.exitIdx);
      const longUsdt = (longWalk.pnl * SIZE) / 100;
      trades.push({
        side: 'LONG',
        entryAt: iso(h1[walk.exitIdx].t),
        exitAt: iso(longWalk.exitT),
        path: longWalk.path,
        usdt: +longUsdt.toFixed(2),
        pnlPct: +longWalk.pnl.toFixed(3),
      });
      busyUntil = longWalk.exitT;
      busySide = 'LONG';
    } else {
      busyUntil = walk.exitT;
      busySide = 'SHORT';
    }
  }
}

function summarize(list) {
  const wins = list.filter((t) => t.usdt > 0).length;
  const usdt = list.reduce((a, t) => a + t.usdt, 0);
  const paths = {};
  for (const t of list) paths[t.path] = (paths[t.path] || 0) + 1;
  return {
    n: list.length,
    wins,
    wr: list.length ? +((100 * wins) / list.length).toFixed(1) : 0,
    usdt: +usdt.toFixed(2),
    avg: list.length ? +(usdt / list.length).toFixed(2) : 0,
    paths,
  };
}

const longs = trades.filter((t) => t.side === 'LONG');
const shorts = trades.filter((t) => t.side === 'SHORT');
const all = summarize(trades);
const longSum = summarize(longs);
const shortSum = summarize(shorts);

console.log('\n── TOTAL ──');
console.log(
  `n=${all.n} WR=${all.wr}% AVG=${all.avg >= 0 ? '+' : ''}${all.avg} USDT=${all.usdt >= 0 ? '+' : ''}${all.usdt}`
);
console.log('paths', all.paths);
console.log('\n── LONG ──');
console.log(
  `n=${longSum.n} WR=${longSum.wr}% AVG=${longSum.avg >= 0 ? '+' : ''}${longSum.avg} USDT=${longSum.usdt >= 0 ? '+' : ''}${longSum.usdt}`
);
console.log('paths', longSum.paths);
console.log('\n── SHORT ──');
console.log(
  `n=${shortSum.n} WR=${shortSum.wr}% AVG=${shortSum.avg >= 0 ? '+' : ''}${shortSum.avg} USDT=${shortSum.usdt >= 0 ? '+' : ''}${shortSum.usdt}`
);
console.log('paths', shortSum.paths);

console.log('\nTrades:');
for (const t of trades) {
  console.log(
    `  ${t.side.padEnd(5)} ${t.entryAt} → ${t.exitAt}  ${t.path.padEnd(10)} ${(t.usdt >= 0 ? '+' : '') + t.usdt.toFixed(1)}`
  );
}

const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const outPath = path.join(DIR, `out-rsi-qqq-long-short-ytd-${stamp}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      meta: {
        strategy: 'rsi_qqq',
        symbol: SYMBOL,
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        long: { sl: LONG_SL, tp1: TP1, tp2: TP2 },
        short: { emaFast: EMA_FAST, emaSlow: EMA_SLOW, sl: SHORT_SL, tp: SHORT_TP },
        feePct: FEE,
        sizeUsdt: SIZE,
      },
      total: all,
      long: longSum,
      short: shortSum,
      trades,
    },
    null,
    2
  )
);
console.log('\nJSON', outPath);
