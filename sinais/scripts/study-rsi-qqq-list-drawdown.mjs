/**
 * rsi_qqq lista operacional — equity + max drawdown (config #3).
 * LONG SL −4% TP1 +2%@50% TP2 +5% | SHORT SL +6% TP −5%
 *   node scripts/study-rsi-qqq-list-drawdown.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FEE = 0.1;
const SIZE = 100;
const RSI_PERIOD = 14;
const RSI_MA = 18;
const CROSS = 34;
const TP1 = 2;
const TP1_POS = 0.5;
const TP2 = 5;
const LONG_SL = 4;
const EMA_FAST = 20;
const EMA_SLOW = 70;
const SHORT_SL = 6;
const SHORT_TP = 5;

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

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-01-01T00:00:00.000Z');
const t1 = Date.now();
const CACHE = path.join(DIR, 'cache-rsi-qqq-universe-ytd-1h.json');
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-rsi-qqq-list-drawdown-${stamp}.json`);

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
  let exitIdx = entryIdx;
  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.l <= slPx) {
      locked += rem * -LONG_SL;
      rem = 0;
      path = hitTp1 ? 'TP1+SL' : 'SL';
      exitT = b.t;
      exitIdx = i;
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

function simulateShort(bars, entryIdx, longSignalIdxs) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 + SHORT_SL / 100);
  const tpPx = entry * (1 - SHORT_TP / 100);
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
    if (b.h >= slPx) return { pnl: -SHORT_SL - FEE, path: 'SL', exitT: b.t, exitIdx: i };
    if (b.l <= tpPx) return { pnl: SHORT_TP - FEE, path: 'TP', exitT: b.t, exitIdx: i };
  }
  const last = bars[bars.length - 1];
  return {
    pnl: ((entry - last.c) / entry) * 100 - FEE,
    path: 'TIME',
    exitT: last.t,
    exitIdx: bars.length - 1,
  };
}

function runSymbol(symbol, h1) {
  if (!h1 || h1.length < EMA_SLOW + RSI_PERIOD + RSI_MA + 10) return [];
  const closes = h1.map((b) => b.c);
  const rsi = rsiSeries(closes, RSI_PERIOD);
  const rsiMa = smaOnSeries(rsi, RSI_MA);
  const emaF = emaSeries(closes, EMA_FAST);
  const emaS = emaSeries(closes, EMA_SLOW);
  const longSignalIdxs = new Set();
  for (let i = 1; i < h1.length; i++) {
    if (h1[i].t < t0 || h1[i].t > t1) continue;
    const curr = rsiMa[i];
    const prev = rsiMa[i - 1];
    if (curr != null && prev != null && prev < CROSS && curr > prev && curr >= CROSS) {
      longSignalIdxs.add(i);
    }
  }
  const trades = [];
  let busyUntil = 0;
  for (let i = 1; i < h1.length; i++) {
    const bar = h1[i];
    if (bar.t < t0 || bar.t > t1) continue;
    if (busyUntil > bar.t) continue;
    const curr = rsiMa[i];
    const prev = rsiMa[i - 1];
    const longSig =
      curr != null && prev != null && prev < CROSS && curr > prev && curr >= CROSS;
    const ef = emaF[i];
    const efp = emaF[i - 1];
    const es = emaS[i];
    const esp = emaS[i - 1];
    const shortSig =
      ef != null && efp != null && es != null && esp != null && efp >= esp && ef < es;

    if (longSig) {
      const walk = simulateLong(h1, i);
      trades.push({
        symbol,
        side: 'LONG',
        entryAt: iso(bar.t),
        entryTs: bar.t,
        exitAt: iso(walk.exitT),
        exitTs: walk.exitT,
        path: walk.path,
        usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
      });
      busyUntil = walk.exitT;
      continue;
    }
    if (shortSig) {
      const walk = simulateShort(h1, i, longSignalIdxs);
      trades.push({
        symbol,
        side: 'SHORT',
        entryAt: iso(bar.t),
        entryTs: bar.t,
        exitAt: iso(walk.exitT),
        exitTs: walk.exitT,
        path: walk.path,
        usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
      });
      if (walk.path === 'FLIP_LONG' && walk.exitIdx >= 0) {
        const lw = simulateLong(h1, walk.exitIdx);
        trades.push({
          symbol,
          side: 'LONG',
          entryAt: iso(h1[walk.exitIdx].t),
          entryTs: h1[walk.exitIdx].t,
          exitAt: iso(lw.exitT),
          exitTs: lw.exitT,
          path: lw.path,
          usdt: +((lw.pnl * SIZE) / 100).toFixed(2),
        });
        busyUntil = lw.exitT;
      } else {
        busyUntil = walk.exitT;
      }
    }
  }
  return trades;
}

if (!existsSync(CACHE)) {
  console.error('Cache em falta:', CACHE);
  process.exit(1);
}
const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const klinesBySym = cached.klines || {};

console.log('═'.repeat(80));
console.log(
  `rsi_qqq drawdown · ${SYMBOLS.length} símbolos · L−${LONG_SL}% TP2+${TP2}% | S+${SHORT_SL}% TP−${SHORT_TP}%`
);
console.log('═'.repeat(80));

const allTrades = [];
for (const sym of SYMBOLS) {
  allTrades.push(...runSymbol(sym, klinesBySym[sym] || []));
}
allTrades.sort((a, b) => a.exitTs - b.exitTs || a.entryTs - b.entryTs);

let equity = 0;
let peak = 0;
let peakAt = null;
let peakTrade = null;
let maxDd = 0;
let maxDdPeakEq = 0;
let maxDdTroughEq = 0;
let maxDdPeakAt = null;
let maxDdTroughAt = null;
let maxDdPeakTrade = null;
let maxDdTroughTrade = null;
const curve = [];
const monthly = {};

for (const [i, t] of allTrades.entries()) {
  equity += t.usdt;
  const month = t.exitAt.slice(0, 7);
  monthly[month] = (monthly[month] || 0) + t.usdt;
  if (equity > peak) {
    peak = equity;
    peakAt = t.exitAt;
    peakTrade = { i: i + 1, ...t, equity: +equity.toFixed(2) };
  }
  const dd = peak - equity;
  if (dd > maxDd) {
    maxDd = dd;
    maxDdPeakEq = peak;
    maxDdTroughEq = equity;
    maxDdPeakAt = peakAt;
    maxDdTroughAt = t.exitAt;
    maxDdPeakTrade = peakTrade;
    maxDdTroughTrade = { i: i + 1, ...t, equity: +equity.toFixed(2) };
  }
  curve.push({
    i: i + 1,
    exitAt: t.exitAt,
    usdt: t.usdt,
    equity: +equity.toFixed(2),
    peak: +peak.toFixed(2),
    dd: +dd.toFixed(2),
  });
}

const wins = allTrades.filter((t) => t.usdt > 0).length;
const totalUsdt = allTrades.reduce((a, t) => a + t.usdt, 0);

// Trades during the max DD window (from peak equity trade to trough)
const peakIdx = maxDdPeakTrade?.i ?? 1;
const troughIdx = maxDdTroughTrade?.i ?? 1;
const ddTrades = allTrades.slice(peakIdx - 1, troughIdx).filter((t) => t.usdt < 0);
ddTrades.sort((a, b) => a.usdt - b.usdt);

console.log('\n── RESUMO ──');
console.log(
  `n=${allTrades.length} WR=${((100 * wins) / allTrades.length).toFixed(1)}% USDT=${totalUsdt >= 0 ? '+' : ''}${totalUsdt.toFixed(1)}`
);
console.log(
  `Max DD = −${maxDd.toFixed(1)} USDT (${peak > 0 ? ((100 * maxDd) / peak).toFixed(1) : 'n/a'}% do pico)`
);
console.log(`Pico equity: ${maxDdPeakEq.toFixed(1)} @ ${maxDdPeakAt} (trade #${peakIdx})`);
console.log(
  `Fundo DD:   ${maxDdTroughEq.toFixed(1)} @ ${maxDdTroughAt} (trade #${troughIdx})`
);
if (maxDdPeakTrade && maxDdTroughTrade) {
  console.log(
    `Janela: ${maxDdPeakAt} → ${maxDdTroughAt} (${troughIdx - peakIdx + 1} trades)`
  );
  console.log(
    `Pico trade: ${maxDdPeakTrade.side} ${maxDdPeakTrade.symbol} ${maxDdPeakTrade.path} ${maxDdPeakTrade.usdt >= 0 ? '+' : ''}${maxDdPeakTrade.usdt}`
  );
  console.log(
    `Fundo trade: ${maxDdTroughTrade.side} ${maxDdTroughTrade.symbol} ${maxDdTroughTrade.path} ${maxDdTroughTrade.usdt >= 0 ? '+' : ''}${maxDdTroughTrade.usdt}`
  );
}

console.log('\n── Piores trades na janela de DD ──');
for (const t of ddTrades.slice(0, 10)) {
  console.log(
    `  ${t.exitAt} ${t.side.padEnd(5)} ${t.symbol.padEnd(14)} ${t.path.padEnd(10)} ${(t.usdt >= 0 ? '+' : '') + t.usdt.toFixed(1)}`
  );
}

console.log('\n── USDT por mês ──');
for (const m of Object.keys(monthly).sort()) {
  const v = monthly[m];
  console.log(`  ${m}  ${(v >= 0 ? '+' : '') + v.toFixed(1)}`);
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        symbols: SYMBOLS.length,
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        long: { sl: LONG_SL, tp1: TP1, tp2: TP2 },
        short: { sl: SHORT_SL, tp: SHORT_TP },
      },
      summary: {
        n: allTrades.length,
        wins,
        wr: +((100 * wins) / allTrades.length).toFixed(1),
        usdt: +totalUsdt.toFixed(2),
        maxDdUsdt: +maxDd.toFixed(2),
        maxDdPctOfPeak: peak > 0 ? +((100 * maxDd) / peak).toFixed(1) : null,
        peakEquity: +maxDdPeakEq.toFixed(2),
        troughEquity: +maxDdTroughEq.toFixed(2),
        peakAt: maxDdPeakAt,
        troughAt: maxDdTroughAt,
        peakTrade: maxDdPeakTrade,
        troughTrade: maxDdTroughTrade,
      },
      monthly,
      worstInDdWindow: ddTrades.slice(0, 15),
      curveSample: curve.filter((_, i) => i % Math.max(1, Math.floor(curve.length / 80)) === 0 || i === curve.length - 1),
    },
    null,
    2
  )
);
console.log('\nJSON', OUT);
