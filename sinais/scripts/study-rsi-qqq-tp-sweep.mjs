/**
 * rsi_qqq YTD — SL −4% fixo · sweep TP2 (4 / 5 / 6 / 8%), TP1 +2%@50%.
 *   node scripts/study-rsi-qqq-tp-sweep.mjs
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
const TP1 = 2;
const TP1_POS = 0.5;
const SL = 4;
const TP2_GRID = [4, 5, 6, 8];

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

function simulate(bars, entryIdx, tp2Pct) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 - SL / 100);
  const tp1Px = entry * (1 + TP1 / 100);
  const tp2Px = entry * (1 + tp2Pct / 100);
  let rem = 1;
  let locked = 0;
  let hitTp1 = false;
  let path = 'OPEN';
  let exitT = bars[entryIdx].t;
  let exitPx = entry;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.l <= slPx) {
      locked += rem * -SL;
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
      locked += rem * tp2Pct;
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

  return { pnl: locked - FEE, path, exitT, exitPx, hitTp1 };
}

function runForTp2(h1, rsiMa, tp2Pct) {
  const trades = [];
  let busyUntil = 0;
  const pathCount = {};
  for (let i = 1; i < h1.length; i++) {
    const bar = h1[i];
    if (bar.t < t0 || bar.t > t1) continue;
    if (busyUntil > bar.t) continue;
    const curr = rsiMa[i];
    const prev = rsiMa[i - 1];
    if (curr == null || prev == null) continue;
    if (!(prev < CROSS && curr > prev && curr >= CROSS)) continue;

    const walk = simulate(h1, i, tp2Pct);
    const usdt = (walk.pnl * SIZE) / 100;
    trades.push({
      entryAt: iso(bar.t),
      exitAt: iso(walk.exitT),
      path: walk.path,
      usdt: +usdt.toFixed(2),
      pnlPct: +walk.pnl.toFixed(3),
      rsiMaPrev: +prev.toFixed(2),
      rsiMa: +curr.toFixed(2),
    });
    pathCount[walk.path] = (pathCount[walk.path] || 0) + 1;
    busyUntil = walk.exitT;
  }
  const wins = trades.filter((t) => t.usdt > 0).length;
  const totalUsdt = trades.reduce((a, t) => a + t.usdt, 0);
  return {
    tp2Pct,
    n: trades.length,
    wins,
    wr: trades.length ? +((100 * wins) / trades.length).toFixed(1) : 0,
    usdt: +totalUsdt.toFixed(2),
    avg: trades.length ? +(totalUsdt / trades.length).toFixed(2) : 0,
    paths: pathCount,
    trades,
  };
}

const t1 = Date.now();
console.log('═'.repeat(80));
console.log(
  `rsi_qqq TP2 sweep · ${SYMBOL} · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
);
console.log(`RSI${RSI_PERIOD} SMA${RSI_MA} ↑${CROSS} | SL −${SL}% | TP1 ${TP1}%@50% | TP2 grid ${TP2_GRID.join(', ')}%`);
console.log('═'.repeat(80));

console.log('A obter 1h…');
const h1 = await fetchKlines(SYMBOL, '60', t0 - 40 * 24 * 3600 * 1000, t1);
console.log(`Velas 1h: ${h1.length}`);
const closes = h1.map((b) => b.c);
const rsi = rsiSeries(closes, RSI_PERIOD);
const rsiMa = smaOnSeries(rsi, RSI_MA);

const rows = TP2_GRID.map((tp2) => runForTp2(h1, rsiMa, tp2));
rows.sort((a, b) => b.usdt - a.usdt);

console.log('\n' + '#'.padStart(2), 'TP2%'.padStart(5), 'n'.padStart(4), 'WR%'.padStart(6), 'AVG'.padStart(8), 'USDT'.padStart(9), 'paths');
for (const [i, r] of rows.entries()) {
  const paths = Object.entries(r.paths)
    .map(([k, n]) => `${k}:${n}`)
    .join(' ');
  console.log(
    String(i + 1).padStart(2),
    r.tp2Pct.toFixed(0).padStart(5),
    String(r.n).padStart(4),
    r.wr.toFixed(1).padStart(6),
    ((r.avg >= 0 ? '+' : '') + r.avg.toFixed(2)).padStart(8),
    ((r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)).padStart(9),
    paths
  );
}

const best = rows[0];
console.log(`\nMelhor: TP2 +${best.tp2Pct}% → n=${best.n} WR=${best.wr}% USDT=${best.usdt >= 0 ? '+' : ''}${best.usdt}`);

const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const outPath = path.join(DIR, `out-rsi-qqq-tp-sweep-${stamp}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      meta: {
        strategy: 'rsi_qqq',
        symbol: SYMBOL,
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        slPct: SL,
        tp1Pct: TP1,
        tp1Pos: TP1_POS * 100,
        feePct: FEE,
        sizeUsdt: SIZE,
      },
      ranking: rows.map(({ trades, ...r }) => r),
      bestTp2: best.tp2Pct,
      bestTrades: best.trades,
    },
    null,
    2
  )
);
console.log('JSON', outPath);
