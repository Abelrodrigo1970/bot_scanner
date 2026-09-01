/**
 * Estudo engolfo LIVE: Scanner 2 top 6 vs top 30
 *
 * Entrada actual + SAI actual: SL +10% | TP1 −20%@50% | resto 24h
 * Também reporta TP15+SL3 (melhor do grid) no top 6.
 *
 * Uso: node scripts/study-engolfo-top6.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 150;
const MIN_QUOTE_VOL = 500_000;
const SCANNER2_TOP = 30;
const LOOKBACK_DAYS = 14;
const MIN_DROP = 1;
const HOLD_H = 24;
const COOLDOWN_BARS = 4;
const SNAP_MS = 4 * 3600_000;
const TP1_POS = 0.5;

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

/** Map<snapTs, Map<symbol, rank>> */
function buildScanner2RankSnapshots(seriesBySym, startMs, endMs) {
  /** @type {Map<number, Map<string, number>>} */
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
    const ranks = new Map();
    for (let i = 0; i < Math.min(SCANNER2_TOP, rows.length); i++) {
      ranks.set(rows[i].sym, i + 1);
    }
    snaps.set(t, ranks);
  }
  return snaps;
}

function scannerRankAt(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const map = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  if (!map || !map.has(sym)) return null;
  return map.get(sym);
}

function walkSell(candles, entryIdx, entry, slPct, tp1Pct) {
  const sl = entry * (1 + slPct / 100);
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

function byRankBucket(trades) {
  const buckets = [
    { name: '1–3', lo: 1, hi: 3 },
    { name: '4–6', lo: 4, hi: 6 },
  ];
  const out = [];
  for (const b of buckets) {
    const sub = trades.filter((t) => t.rank >= b.lo && t.rank <= b.hi);
    if (!sub.length) continue;
    const sum = sub.reduce((a, t) => a + t.pnl, 0);
    out.push({
      name: b.name,
      n: sub.length,
      avg: sum / sub.length,
      usdt: (sum * SIZE) / 100,
      wr: (100 * sub.filter((t) => t.pnl >= 0).length) / sub.length,
    });
  }
  return out;
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warmMs = Math.max(40 * 15 * 60_000, 26 * 3600_000);

  console.log('═'.repeat(88));
  console.log(
    `ENGOLFO LIVE top6 vs top30 | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
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

  console.log('Fase 2: snapshots Scanner 2 com ranks…');
  const snaps = buildScanner2RankSnapshots(series, startMs, endMs);
  console.log(`Snapshots: ${snaps.size}`);

  const top30_tp20sl10 = [];
  const top6_tp20sl10 = [];
  const top6_tp15sl3 = [];
  const top6_tp10sl10 = [];

  console.log('Fase 3: sinais…');
  let si = 0;
  for (const [sym, c15] of series) {
    si++;
    process.stdout.write(`\r  ${si}/${series.size} ${sym.padEnd(16)}`);
    const closes = c15.map((c) => c.c);
    const e12 = emaSeries(closes, 12);
    const e21 = emaSeries(closes, 21);
    let last30 = -COOLDOWN_BARS;
    let last6 = -COOLDOWN_BARS;

    for (let i = 100; i < c15.length - 1; i++) {
      const t = c15[i].t;
      if (t < startMs || t > endMs) continue;
      const rank = scannerRankAt(snaps, t, sym);
      if (rank == null) continue;

      const prev = c15[i - 1];
      const curr = c15[i];
      if (!(prev.c > 0) || !(curr.c > 0)) continue;
      if (!(curr.c < curr.o)) continue;
      const dropPct = ((prev.c - curr.c) / prev.c) * 100;
      if (dropPct < MIN_DROP) continue;
      if (e12[i] == null || e21[i] == null) continue;
      if (!(e12[i] < e21[i] && curr.c < e21[i])) continue;

      const day = new Date(t).toISOString().slice(0, 10);
      const meta = { sym, day, drop: +dropPct.toFixed(2), rank };

      if (i - last30 >= COOLDOWN_BARS) {
        top30_tp20sl10.push({ ...meta, ...walkSell(c15, i, curr.c, 10, 20) });
        last30 = i;
      }

      if (rank <= 6 && i - last6 >= COOLDOWN_BARS) {
        top6_tp20sl10.push({ ...meta, ...walkSell(c15, i, curr.c, 10, 20) });
        top6_tp15sl3.push({ ...meta, ...walkSell(c15, i, curr.c, 3, 15) });
        top6_tp10sl10.push({ ...meta, ...walkSell(c15, i, curr.c, 10, 10) });
        last6 = i;
      }
    }
  }
  process.stdout.write('\n');

  const s30 = summarize('Top30 + TP20 + SL10 (actual)', top30_tp20sl10);
  const s6 = summarize('Top6 + TP20 + SL10 (actual sai)', top6_tp20sl10);
  const s6b = summarize('Top6 + TP15 + SL3 (melhor grid)', top6_tp15sl3);
  const s6c = summarize('Top6 + TP10 + SL10', top6_tp10sl10);

  const buckets = byRankBucket(top6_tp20sl10);
  console.log('\nTop6 actual — 1–3 vs 4–6:');
  for (const b of buckets) {
    console.log(
      `  ${b.name} n=${b.n} avg=${b.avg.toFixed(2)}% USDT=${b.usdt.toFixed(0)} WR=${b.wr.toFixed(1)}%`
    );
  }

  const best = [...top6_tp20sl10].sort((a, b) => b.pnl - a.pnl).slice(0, 8);
  const worst = [...top6_tp20sl10].sort((a, b) => a.pnl - b.pnl).slice(0, 8);
  console.log('\nTop wins Top6 actual:');
  for (const t of best)
    console.log(
      `  ${t.day} ${t.sym} #${t.rank} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path}`
    );
  console.log('Top losses Top6 actual:');
  for (const t of worst)
    console.log(
      `  ${t.day} ${t.sym} #${t.rank} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path}`
    );

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner2_reconstruido_4h',
    top30_actual: s30,
    top6_actual: s6,
    top6_tp15sl3: s6b,
    top6_tp10sl10: s6c,
    top6_buckets_actual: buckets,
    byDayTop6: byDayRows(top6_tp20sl10),
    byDayTop30: byDayRows(top30_tp20sl10),
    bestTop6: best.map((t) => ({
      day: t.day,
      sym: t.sym,
      rank: t.rank,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
    })),
    worstTop6: worst.map((t) => ({
      day: t.day,
      sym: t.sym,
      rank: t.rank,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
    })),
  };

  const path = new URL('./out-engolfo-top6.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
