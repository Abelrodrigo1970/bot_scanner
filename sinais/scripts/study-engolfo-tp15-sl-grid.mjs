/**
 * Estudo engolfo LIVE: TP1 −15%@50% × SL 3% / 5% / 7%
 *
 * Entrada: bear + drop≥1% + EMA12 < EMA21 + fecho < EMA21
 * SAI: TP1 −15% (50%) | resto 24h | fee 0,1%
 *
 * Uso: node scripts/study-engolfo-tp15-sl-grid.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 150;
const MIN_QUOTE_VOL = 500_000;
const SCANNER2_TOP = 30;
const LOOKBACK_DAYS = 14;
const MIN_DROP = 1;
const TP1_PCT = 15;
const TP1_POS = 0.5;
const HOLD_H = 24;
const COOLDOWN_BARS = 4;
const SNAP_MS = 4 * 3600_000;
const SL_LEVELS = [3, 5, 7];

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

function walkSell(candles, entryIdx, entry, slPct) {
  const sl = entry * (1 + slPct / 100);
  const t1 = entry * (1 - TP1_PCT / 100);
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
    `ENGOLFO LIVE TP15 × SL ${SL_LEVELS.join('/')}% | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
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

  console.log('Fase 2: snapshots Scanner 2…');
  const snaps = buildScanner2Snapshots(series, startMs, endMs);
  console.log(`Snapshots: ${snaps.size}`);

  /** @type {Record<number, any[]>} */
  const bags = Object.fromEntries(SL_LEVELS.map((sl) => [sl, []]));
  /** ref actual SL10 + TP15 for comparison */
  bags[10] = [];

  console.log('Fase 3: sinais…');
  let si = 0;
  for (const [sym, c15] of series) {
    si++;
    process.stdout.write(`\r  ${si}/${series.size} ${sym.padEnd(16)}`);
    const closes = c15.map((c) => c.c);
    const e12 = emaSeries(closes, 12);
    const e21 = emaSeries(closes, 21);
    let last = -COOLDOWN_BARS;

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
      if (e12[i] == null || e21[i] == null) continue;
      if (!(e12[i] < e21[i] && curr.c < e21[i])) continue;
      if (i - last < COOLDOWN_BARS) continue;

      const day = new Date(t).toISOString().slice(0, 10);
      const meta = { sym, day, drop: +dropPct.toFixed(2) };
      for (const sl of [...SL_LEVELS, 10]) {
        bags[sl].push({ ...meta, ...walkSell(c15, i, curr.c, sl) });
      }
      last = i;
    }
  }
  process.stdout.write('\n');

  /** @type {Record<string, any>} */
  const summaries = {};
  for (const sl of [...SL_LEVELS, 10]) {
    const tag = sl === 10 ? ' (ref SL actual)' : '';
    summaries[`sl${sl}`] = summarize(`LIVE + TP1 −${TP1_PCT}%@50% + SL +${sl}%${tag}`, bags[sl]);
  }

  const ranked = SL_LEVELS.map((sl) => ({ sl, ...summaries[`sl${sl}`] })).sort(
    (a, b) => b.usdt - a.usdt
  );
  console.log(`\nMelhor SL entre 3/5/7%: +${ranked[0].sl}% (USDT ${ranked[0].usdt.toFixed(0)})`);

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner2_TOP30_24h_reconstruido_4h',
    entry: 'LIVE engolfo',
    tp1Pct: TP1_PCT,
    tp1Pos: TP1_POS,
    sl3: summaries.sl3,
    sl5: summaries.sl5,
    sl7: summaries.sl7,
    sl10ref: summaries.sl10,
    bestAmong357: ranked[0].sl,
    byDaySl3: byDayRows(bags[3]),
    byDaySl5: byDayRows(bags[5]),
    byDaySl7: byDayRows(bags[7]),
  };

  const path = new URL('./out-engolfo-tp15-sl-grid.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
