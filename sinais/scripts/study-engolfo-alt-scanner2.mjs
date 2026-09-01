/**
 * Estudo: engolfo ALT vs OLD — só universo Scanner 2
 *
 * Scanner 2 (reconstruído): a cada 4h, top 30 USDT-M com maior subida 24h
 * (retorno > 0), entre candidatos top volume.
 *
 * ALT: bear + drop≥1% + fecho < EMA12 e < EMA21 + dist abaixo MA21 ≤ 7%
 * OLD: bear + drop≥1% + EMA12 < EMA21 + fecho < EMA21
 *
 * SAI: SL +10% | TP1 −20%@50% | resto 24h | fee 0,1%
 *
 * Uso: node scripts/study-engolfo-alt-scanner2.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 150;
const MIN_QUOTE_VOL = 500_000; // Scanner 2
const SCANNER2_TOP = 30;
const LOOKBACK_DAYS = 14;
const MIN_DROP = 1;
const MAX_DIST_BELOW_21 = 7;
const SL_PCT = 10;
const TP1_PCT = 20;
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

/** Map<snapTs, Set<symbol>> top SCANNER2_TOP por retorno 24h > 0 */
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

function walkSell(candles, entryIdx, entry) {
  const sl = entry * (1 + SL_PCT / 100);
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

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warmMs = Math.max(40 * 15 * 60_000, 26 * 3600_000);

  console.log('═'.repeat(88));
  console.log(
    `ENGOLFO ALT vs OLD × Scanner 2 | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
  );
  console.log(
    `Candidatos ${CANDIDATE_LIMIT} vol≥${(MIN_QUOTE_VOL / 1e3).toFixed(0)}k | S2 top ${SCANNER2_TOP} / 4h | ALT dist≤${MAX_DIST_BELOW_21}%`
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

  const tradesAlt = [];
  const tradesOld = [];

  console.log('Fase 3: sinais…');
  let si = 0;
  for (const [sym, c15] of series) {
    si++;
    process.stdout.write(`\r  ${si}/${series.size} ${sym.padEnd(16)}`);
    const closes = c15.map((c) => c.c);
    const e12 = emaSeries(closes, 12);
    const e21 = emaSeries(closes, 21);
    let lastAlt = -COOLDOWN_BARS;
    let lastOld = -COOLDOWN_BARS;

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

      const belowBoth = curr.c < e12[i] && curr.c < e21[i];
      const distBelow21 = ((e21[i] - curr.c) / e21[i]) * 100;
      const notTooDeep = distBelow21 <= MAX_DIST_BELOW_21;

      if (belowBoth && notTooDeep && i - lastAlt >= COOLDOWN_BARS) {
        const ex = walkSell(c15, i, curr.c);
        tradesAlt.push({
          sym,
          day: new Date(t).toISOString().slice(0, 10),
          drop: +dropPct.toFixed(2),
          dist21: +distBelow21.toFixed(2),
          stack12lt21: e12[i] < e21[i],
          ...ex,
        });
        lastAlt = i;
      }

      if (e12[i] < e21[i] && curr.c < e21[i] && i - lastOld >= COOLDOWN_BARS) {
        const ex = walkSell(c15, i, curr.c);
        tradesOld.push({
          sym,
          day: new Date(t).toISOString().slice(0, 10),
          drop: +dropPct.toFixed(2),
          dist21: +distBelow21.toFixed(2),
          ...ex,
        });
        lastOld = i;
      }
    }
  }
  process.stdout.write('\n');

  const sAlt = summarize(
    `ALT × Scanner 2: fecho < MA12 & MA21 + dist≤${MAX_DIST_BELOW_21}%`,
    tradesAlt
  );
  const sOld = summarize('OLD × Scanner 2: EMA12<EMA21 + fecho<EMA21', tradesOld);

  const best = [...tradesAlt].sort((a, b) => b.pnl - a.pnl).slice(0, 8);
  const worst = [...tradesAlt].sort((a, b) => a.pnl - b.pnl).slice(0, 8);
  console.log('\nTop wins ALT×S2:');
  for (const t of best)
    console.log(
      `  ${t.day} ${t.sym} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} drop=${t.drop}% dist21=${t.dist21}%`
    );
  console.log('Top losses ALT×S2:');
  for (const t of worst)
    console.log(
      `  ${t.day} ${t.sym} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} drop=${t.drop}% dist21=${t.dist21}%`
    );

  const byDay = {};
  for (const t of tradesAlt) {
    if (!byDay[t.day]) byDay[t.day] = { n: 0, sum: 0 };
    byDay[t.day].n++;
    byDay[t.day].sum += t.pnl;
  }
  console.log('\nP&L diário ALT×S2:');
  for (const d of Object.keys(byDay).sort()) {
    const x = byDay[d];
    console.log(
      `  ${d} n=${x.n} sum=${x.sum >= 0 ? '+' : ''}${x.sum.toFixed(2)}% USDT=${((x.sum * SIZE) / 100).toFixed(0)}`
    );
  }

  const buckets = [
    { name: '0–2%', lo: 0, hi: 2 },
    { name: '2–4%', lo: 2, hi: 4 },
    { name: '4–7%', lo: 4, hi: 7.0001 },
  ];
  const byDist = [];
  console.log('\nALT×S2 por dist abaixo MA21:');
  for (const b of buckets) {
    const sub = tradesAlt.filter((t) => t.dist21 >= b.lo && t.dist21 < b.hi);
    if (!sub.length) continue;
    const sum = sub.reduce((a, t) => a + t.pnl, 0);
    const wr = (100 * sub.filter((t) => t.pnl >= 0).length) / sub.length;
    console.log(
      `  ${b.name} n=${sub.length} avg=${(sum / sub.length).toFixed(2)}% USDT=${((sum * SIZE) / 100).toFixed(0)} WR=${wr.toFixed(1)}%`
    );
    byDist.push({
      name: b.name,
      n: sub.length,
      avg: sum / sub.length,
      usdt: (sum * SIZE) / 100,
      wr,
    });
  }

  const withStack = tradesAlt.filter((t) => t.stack12lt21);
  const withoutStack = tradesAlt.filter((t) => !t.stack12lt21);
  const stackSum = (arr) =>
    arr.length
      ? {
          n: arr.length,
          avg: arr.reduce((a, t) => a + t.pnl, 0) / arr.length,
          usdt: (arr.reduce((a, t) => a + t.pnl, 0) * SIZE) / 100,
          wr: (100 * arr.filter((t) => t.pnl >= 0).length) / arr.length,
        }
      : null;

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner2_TOP30_24h_reconstruido_4h',
    candidates: symbols.length,
    seriesOk: series.size,
    snapshots4h: snaps.size,
    alt: sAlt,
    old: sOld,
    altWithStack12lt21: stackSum(withStack),
    altWithoutStack12lt21: stackSum(withoutStack),
    byDist,
    best: best.map((t) => ({
      day: t.day,
      sym: t.sym,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
      drop: t.drop,
      dist21: t.dist21,
    })),
    worst: worst.map((t) => ({
      day: t.day,
      sym: t.sym,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
      drop: t.drop,
      dist21: t.dist21,
    })),
    byDay: Object.keys(byDay)
      .sort()
      .map((d) => ({
        d,
        n: byDay[d].n,
        sum: +byDay[d].sum.toFixed(2),
        usdt: +((byDay[d].sum * SIZE) / 100).toFixed(2),
      })),
  };

  const path = new URL('./out-engolfo-alt-scanner2.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
