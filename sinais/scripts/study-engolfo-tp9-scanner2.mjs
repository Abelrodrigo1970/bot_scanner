/**
 * Estudo: engolfo — TP1 −20%@50% vs TP1 −9%@50%
 * Entrada LIVE (OLD): bear + drop≥1% + EMA12 < EMA21 + fecho < EMA21
 * Também reporta NEW entry (fecho <12&21 + dist21<10%) com ambos os TPs.
 *
 * SAI comum: SL +10% | resto 24h | fee 0,1% | $100
 * Universo: Scanner 2 reconstruído
 *
 * Uso: node scripts/study-engolfo-tp9-scanner2.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 150;
const MIN_QUOTE_VOL = 500_000;
const SCANNER2_TOP = 30;
const LOOKBACK_DAYS = 14;
const MIN_DROP = 1;
const MAX_DIST_BELOW_21 = 10;
const SL_PCT = 10;
const TP1_POS = 0.5;
const HOLD_H = 24;
const COOLDOWN_BARS = 4;
const SNAP_MS = 4 * 3600_000;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function candidateSymbols() {
  const data = await fetchJson(`${BINANCE}/fapi/v1/ticker/24hr`);
  return data
    .filter(
      (t) =>
        typeof t.symbol === 'string' &&
        t.symbol.endsWith('USDT') &&
        !t.symbol.includes('_') &&
        +t.quoteVolume >= MIN_QUOTE_VOL
    )
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, CANDIDATE_LIMIT)
    .map((t) => t.symbol);
}

async function fetchKlines(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const step = 15 * 60_000;
  while (cursor < endMs) {
    const url =
      `${BINANCE}/fapi/v1/klines?symbol=${symbol}&interval=15m` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1500`;
    const list = await fetchJson(url);
    if (!Array.isArray(list) || !list.length) break;
    for (const r of list) {
      const t = +r[0];
      if (t >= startMs && t <= endMs) {
        out.push({ t, o: +r[1], h: +r[2], l: +r[3], c: +r[4] });
      }
    }
    const last = +list[list.length - 1][0];
    if (last + step <= cursor) break;
    cursor = last + step;
    if (list.length < 1500) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
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

function buildScanner2Snapshots(seriesBySym, startMs, endMs) {
  /** @type {Map<number, Set<string>>} */
  const snaps = new Map();
  const from = alignDown(startMs, SNAP_MS);
  for (let t = from; t <= endMs; t += SNAP_MS) {
    const rows = [];
    for (const [sym, candles] of seriesBySym) {
      const iNow = findIdxAtOrBefore(candles, t);
      const iPrev = findIdxAtOrBefore(candles, t - 24 * 3600_000);
      if (iNow < 0 || iPrev < 0 || iPrev >= iNow) continue;
      const c0 = candles[iPrev].c;
      const c1 = candles[iNow].c;
      if (!(c0 > 0)) continue;
      const ret = ((c1 - c0) / c0) * 100;
      if (ret > 0) rows.push({ sym, ret });
    }
    rows.sort((a, b) => b.ret - a.ret);
    snaps.set(t, new Set(rows.slice(0, SCANNER2_TOP).map((r) => r.sym)));
  }
  return snaps;
}

function inScanner2(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set ? set.has(sym) : false;
}

function walkSell(candles, entryIdx, entry, tp1Pct) {
  const sl = entry * (1 + SL_PCT / 100);
  const t1 = entry * (1 - tp1Pct / 100);
  const endT = candles[entryIdx].t + HOLD_H * 3600_000;
  let hitT1 = false;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) break;
    const hitSl = b.h >= sl;
    const hit1 = b.l <= t1;
    if (!hitT1) {
      if (hitSl && hit1) return { pnl: ((entry - sl) / entry) * 100 - FEE, path: 'SL' };
      if (hitSl) return { pnl: ((entry - sl) / entry) * 100 - FEE, path: 'SL' };
      if (hit1) {
        hitT1 = true;
        continue;
      }
    } else if (hitSl) {
      const p1 = ((entry - t1) / entry) * 100;
      const p2 = ((entry - sl) / entry) * 100;
      return { pnl: TP1_POS * p1 + (1 - TP1_POS) * p2 - FEE, path: 'T1+SL' };
    }
  }

  let last = null;
  for (let i = entryIdx; i < candles.length; i++) {
    if (candles[i].t <= endT) last = candles[i];
  }
  if (!last) last = candles[candles.length - 1];
  const closeP = ((entry - last.c) / entry) * 100;
  if (hitT1) {
    const p1 = ((entry - t1) / entry) * 100;
    return { pnl: TP1_POS * p1 + (1 - TP1_POS) * closeP - FEE, path: 'T1+24h' };
  }
  return { pnl: closeP - FEE, path: '24h' };
}

function summarize(label, trades) {
  if (!trades.length) {
    console.log(`\n${label}: 0 trades`);
    return { label, n: 0, avg: 0, usdt: 0, wr: 0, byPath: {} };
  }
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl >= 0).length;
  const byPath = {};
  for (const t of trades) byPath[t.path] = (byPath[t.path] || 0) + 1;
  const s = {
    label,
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins) / trades.length,
    byPath,
  };
  console.log('\n' + '─'.repeat(88));
  console.log(label);
  console.log(
    `n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}%`,
    s.byPath
  );
  return s;
}

function byDayRows(trades) {
  const byDay = {};
  for (const t of trades) {
    if (!byDay[t.day]) byDay[t.day] = { n: 0, sum: 0 };
    byDay[t.day].n++;
    byDay[t.day].sum += t.pnl;
  }
  return Object.keys(byDay)
    .sort()
    .map((d) => ({
      d,
      n: byDay[d].n,
      sum: +byDay[d].sum.toFixed(2),
      usdt: +((byDay[d].sum * SIZE) / 100).toFixed(2),
    }));
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warmMs = Math.max(40 * 15 * 60_000, 26 * 3600_000);

  console.log('═'.repeat(88));
  console.log(
    `ENGOLFO TP1 20% vs 9% × Scanner 2 | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
  );
  console.log('═'.repeat(88));

  const symbols = await candidateSymbols();
  console.log(`Candidatos: ${symbols.length}`);

  console.log('\nFase 1: klines 15m…');
  /** @type {Map<string, any[]>} */
  const series = new Map();
  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    process.stdout.write(`\r  ${si + 1}/${symbols.length} ${sym.padEnd(16)}`);
    try {
      const c = await fetchKlines(sym, startMs - warmMs, endMs + HOLD_H * 3600_000);
      if (c.length >= 100) series.set(sym, c);
    } catch {
      /* skip */
    }
  }
  process.stdout.write('\n');
  console.log(`Séries OK: ${series.size}`);

  console.log('Fase 2: snapshots Scanner 2 (4h)…');
  const snaps = buildScanner2Snapshots(series, startMs, endMs);
  console.log(`Snapshots: ${snaps.size}`);

  /** @type {any[]} */
  const liveTp20 = [];
  /** @type {any[]} */
  const liveTp9 = [];
  /** @type {any[]} */
  const newTp20 = [];
  /** @type {any[]} */
  const newTp9 = [];

  console.log('Fase 3: sinais…');
  let si = 0;
  for (const [sym, c15] of series) {
    si++;
    process.stdout.write(`\r  ${si}/${series.size} ${sym.padEnd(16)}`);
    const closes = c15.map((c) => c.c);
    const e12 = emaSeries(closes, 12);
    const e21 = emaSeries(closes, 21);
    let lastLive = -COOLDOWN_BARS;
    let lastNew = -COOLDOWN_BARS;

    for (let i = 100; i < c15.length - 1; i++) {
      const t = c15[i].t;
      if (t < startMs || t > endMs) continue;
      if (!inScanner2(snaps, t, sym)) continue;

      const prev = c15[i - 1];
      const curr = c15[i];
      if (!(prev.c > 0) || !(curr.c > 0)) continue;
      if (!(curr.c < curr.o)) continue;
      const dropPct = ((prev.c - curr.c) / prev.c) * 100;
      if (dropPct < MIN_DROP) continue;
      if (e12[i] == null || e21[i] == null || !(e21[i] > 0)) continue;

      const day = new Date(t).toISOString().slice(0, 10);
      const meta = { sym, day, drop: +dropPct.toFixed(2) };

      const isLive = e12[i] < e21[i] && curr.c < e21[i];
      if (isLive && i - lastLive >= COOLDOWN_BARS) {
        liveTp20.push({ ...meta, ...walkSell(c15, i, curr.c, 20) });
        liveTp9.push({ ...meta, ...walkSell(c15, i, curr.c, 9) });
        lastLive = i;
      }

      const distBelow21 = ((e21[i] - curr.c) / e21[i]) * 100;
      const isNew = curr.c < e12[i] && curr.c < e21[i] && distBelow21 < MAX_DIST_BELOW_21;
      if (isNew && i - lastNew >= COOLDOWN_BARS) {
        newTp20.push({ ...meta, dist21: +distBelow21.toFixed(2), ...walkSell(c15, i, curr.c, 20) });
        newTp9.push({ ...meta, dist21: +distBelow21.toFixed(2), ...walkSell(c15, i, curr.c, 9) });
        lastNew = i;
      }
    }
  }
  process.stdout.write('\n');

  const sLive20 = summarize('LIVE entry + TP1 −20%@50%', liveTp20);
  const sLive9 = summarize('LIVE entry + TP1 −9%@50%', liveTp9);
  const sNew20 = summarize('NEW entry + TP1 −20%@50%', newTp20);
  const sNew9 = summarize('NEW entry + TP1 −9%@50%', newTp9);

  const deltaLive = {
    avg: sLive9.avg - sLive20.avg,
    usdt: sLive9.usdt - sLive20.usdt,
    wr: sLive9.wr - sLive20.wr,
  };
  console.log('\nΔ LIVE (TP9 − TP20):');
  console.log(
    `  avg ${deltaLive.avg >= 0 ? '+' : ''}${deltaLive.avg.toFixed(2)}pp | USDT ${deltaLive.usdt >= 0 ? '+' : ''}${deltaLive.usdt.toFixed(0)} | WR ${deltaLive.wr >= 0 ? '+' : ''}${deltaLive.wr.toFixed(1)}pp`
  );

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner2_TOP30_24h_reconstruido_4h',
    note: 'Mesmas entradas; só muda o nível do TP1 parcial (50% pos.)',
    liveTp20: sLive20,
    liveTp9: sLive9,
    newTp20: sNew20,
    newTp9: sNew9,
    deltaLive,
    byDayLiveTp20: byDayRows(liveTp20),
    byDayLiveTp9: byDayRows(liveTp9),
  };

  const path = new URL('./out-engolfo-tp9-scanner2.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
