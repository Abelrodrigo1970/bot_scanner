/**
 * rsi_qqq YTD — QQQUSDT 1h
 * Entrada: RSI SMA18 cruza ↑34 (ex. 33→35)
 * Saída: SL −1% | TP1 +2%@50% | TP2 +4%@50%
 *
 *   node scripts/study-rsi-qqq-ytd.mjs
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
const SL = 1;
const TP1 = 2;
const TP1_POS = 0.5;
const TP2 = 4;
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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
function bump(map, key, usdt) {
  const cur = map.get(key) || { n: 0, wins: 0, usdt: 0 };
  cur.n++;
  cur.usdt += usdt;
  if (usdt > 0) cur.wins++;
  map.set(key, cur);
}
function finalize(map, sortFn) {
  return [...map.entries()]
    .map(([k, v]) => ({
      key: k,
      n: v.n,
      wins: v.wins,
      wr: +((100 * v.wins) / v.n).toFixed(1),
      usdt: +v.usdt.toFixed(2),
    }))
    .sort(sortFn);
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

function simulate(bars, entryIdx) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 - SL / 100);
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

  const pnl = locked - FEE;
  return { pnl, path, exitT, exitPx, hitTp1 };
}

const t1 = Date.now();
console.log('═'.repeat(80));
console.log(
  `rsi_qqq · ${SYMBOL} · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
);
console.log(`RSI${RSI_PERIOD} SMA${RSI_MA} cruza ↑${CROSS} | SL −${SL}% | TP ${TP1}%@${TP1_POS * 100}% + ${TP2}%@${(1 - TP1_POS) * 100}%`);
console.log('═'.repeat(80));

console.log('A obter 1h…');
const warm = t0 - 40 * 24 * 3600 * 1000;
const h1 = await fetchKlines(SYMBOL, '60', warm, t1);
console.log(`Velas 1h: ${h1.length}`);
if (h1.length < 100) {
  console.error('Poucas velas');
  process.exit(1);
}

const closes = h1.map((b) => b.c);
const rsi = rsiSeries(closes, RSI_PERIOD);
const rsiMa = smaOnSeries(rsi, RSI_MA);

const trades = [];
let busyUntil = 0;
for (let i = 1; i < h1.length; i++) {
  const bar = h1[i];
  if (bar.t < t0 || bar.t > t1) continue;
  if (busyUntil > bar.t) continue;
  const curr = rsiMa[i];
  const prev = rsiMa[i - 1];
  if (curr == null || prev == null) continue;
  if (!(prev < CROSS && curr > prev && curr >= CROSS)) continue;

  const walk = simulate(h1, i);
  const usdt = (walk.pnl * SIZE) / 100;
  const d = new Date(bar.t);
  trades.push({
    entryAt: iso(bar.t),
    exitAt: iso(walk.exitT),
    entry: +bar.c.toFixed(6),
    exit: +walk.exitPx.toFixed(6),
    path: walk.path,
    pnlPct: +walk.pnl.toFixed(3),
    usdt: +usdt.toFixed(2),
    rsiMaPrev: +prev.toFixed(2),
    rsiMa: +curr.toFixed(2),
    dow: DOW[d.getUTCDay()],
    hour: d.getUTCHours(),
    month: iso(bar.t).slice(0, 7),
    holdH: +((walk.exitT - bar.t) / 3600000).toFixed(1),
  });
  busyUntil = walk.exitT;
}

const wins = trades.filter((t) => t.usdt > 0).length;
const totalUsdt = trades.reduce((a, t) => a + t.usdt, 0);
const byDow = new Map();
const byHour = new Map();
const byMonth = new Map();
const byPath = new Map();
for (const t of trades) {
  bump(byDow, t.dow, t.usdt);
  bump(byHour, String(t.hour).padStart(2, '0') + 'h', t.usdt);
  bump(byMonth, t.month, t.usdt);
  bump(byPath, t.path, t.usdt);
}

console.log('\nRESULTADO');
console.log(
  `n=${trades.length} WR=${trades.length ? ((100 * wins) / trades.length).toFixed(1) : 0}% USDT=${totalUsdt >= 0 ? '+' : ''}${totalUsdt.toFixed(1)}`
);
console.log('\nPor path:');
for (const r of finalize(byPath, (a, b) => b.usdt - a.usdt)) {
  console.log(`  ${r.key.padEnd(10)} n=${r.n} WR=${r.wr}% USDT=${(r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)}`);
}
console.log('\nPor mês:');
for (const r of finalize(byMonth, (a, b) => a.key.localeCompare(b.key))) {
  console.log(`  ${r.key} n=${r.n} WR=${r.wr}% USDT=${(r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)}`);
}
console.log('\nTrades:');
for (const t of trades) {
  console.log(
    `  ${t.entryAt} → ${t.exitAt}  RSI ${t.rsiMaPrev}→${t.rsiMa}  ${t.path.padEnd(9)} ${(t.usdt >= 0 ? '+' : '') + t.usdt.toFixed(2)}`
  );
}

const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const out = {
  meta: {
    strategy: 'rsi_qqq',
    symbol: SYMBOL,
    from: new Date(t0).toISOString(),
    to: new Date(t1).toISOString(),
    rules: `RSI${RSI_PERIOD} SMA${RSI_MA} cruza ↑${CROSS} | SL −${SL}% | TP1 +${TP1}%@${TP1_POS * 100}% | TP2 +${TP2}%@${(1 - TP1_POS) * 100}%`,
    feePct: FEE,
    sizeUsdt: SIZE,
    nTrades: trades.length,
    wr: trades.length ? +((100 * wins) / trades.length).toFixed(1) : 0,
    totalUsdt: +totalUsdt.toFixed(2),
  },
  byDow: finalize(byDow, (a, b) => DOW.indexOf(a.key) - DOW.indexOf(b.key)),
  byHour: finalize(byHour, (a, b) => a.key.localeCompare(b.key)),
  byMonth: finalize(byMonth, (a, b) => a.key.localeCompare(b.key)),
  byPath: finalize(byPath, (a, b) => b.usdt - a.usdt),
  trades,
};
const jsonPath = path.join(DIR, `out-rsi-qqq-ytd-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(out, null, 2));
console.log('\nJSON', jsonPath);
