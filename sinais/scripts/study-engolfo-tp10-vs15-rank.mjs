/**
 * Estudo engolfo LIVE: TP1 −10% vs −15% (@50%)
 * + ranking Scanner 2 nos trades vencedores
 *
 * Entrada: bear + drop≥1% + EMA12 < EMA21 + fecho < EMA21
 * SAI: SL +10% | resto 24h | fee 0,1%
 *
 * Uso: node scripts/study-engolfo-tp10-vs15-rank.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 150;
const MIN_QUOTE_VOL = 500_000;
const SCANNER2_TOP = 30;
const LOOKBACK_DAYS = 14;
const MIN_DROP = 1;
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

/** Map<snapTs, Map<symbol, rank1to30>> */
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
    /** @type {Map<string, number>} */
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
  if (!map) return null;
  return map.has(sym) ? map.get(sym) : null;
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

function rankBucket(rank) {
  if (rank == null) return 'fora';
  if (rank <= 3) return '1–3';
  if (rank <= 5) return '4–5';
  if (rank <= 10) return '6–10';
  if (rank <= 15) return '11–15';
  if (rank <= 20) return '16–20';
  return '21–30';
}

function analyzeRanks(trades, label) {
  const wins = trades.filter((t) => t.pnl >= 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const withRank = trades.filter((t) => t.rank != null);
  const winsWithRank = wins.filter((t) => t.rank != null);

  const avg = (arr) => (arr.length ? arr.reduce((a, t) => a + t.rank, 0) / arr.length : null);
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].map((t) => t.rank).sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const buckets = ['1–3', '4–5', '6–10', '11–15', '16–20', '21–30'];
  const byBucket = [];
  console.log(`\n${label} — por rank Scanner 2:`);
  for (const name of buckets) {
    const sub = withRank.filter((t) => rankBucket(t.rank) === name);
    if (!sub.length) continue;
    const sum = sub.reduce((a, t) => a + t.pnl, 0);
    const wr = (100 * sub.filter((t) => t.pnl >= 0).length) / sub.length;
    console.log(
      `  rank ${name} n=${sub.length} avg=${(sum / sub.length).toFixed(2)}% USDT=${((sum * SIZE) / 100).toFixed(0)} WR=${wr.toFixed(1)}%`
    );
    byBucket.push({
      name,
      n: sub.length,
      avg: sum / sub.length,
      usdt: (sum * SIZE) / 100,
      wr,
      wins: sub.filter((t) => t.pnl >= 0).length,
    });
  }

  const winRankDist = {};
  for (const t of winsWithRank) {
    const b = rankBucket(t.rank);
    winRankDist[b] = (winRankDist[b] || 0) + 1;
  }

  const topWins = [...winsWithRank].sort((a, b) => b.pnl - a.pnl).slice(0, 15);
  console.log(`\n${label} — top wins (com rank):`);
  for (const t of topWins) {
    console.log(
      `  ${t.day} ${t.sym} rank=#${t.rank} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} drop=${t.drop}%`
    );
  }

  const stats = {
    nTrades: trades.length,
    nWithRank: withRank.length,
    nWins: wins.length,
    nWinsWithRank: winsWithRank.length,
    avgRankAll: avg(withRank),
    avgRankWins: avg(winsWithRank),
    avgRankLosses: avg(losses.filter((t) => t.rank != null)),
    medianRankWins: median(winsWithRank),
    medianRankLosses: median(losses.filter((t) => t.rank != null)),
    winRankDist,
    byBucket,
    topWins: topWins.map((t) => ({
      day: t.day,
      sym: t.sym,
      rank: t.rank,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
      drop: t.drop,
    })),
  };

  console.log(
    `\n${label} ranks: avg all=${stats.avgRankAll?.toFixed(1)} | wins=${stats.avgRankWins?.toFixed(1)} (med ${stats.medianRankWins}) | losses=${stats.avgRankLosses?.toFixed(1)} (med ${stats.medianRankLosses})`
  );
  return stats;
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warmMs = Math.max(40 * 15 * 60_000, 26 * 3600_000);

  console.log('═'.repeat(88));
  console.log(
    `ENGOLFO LIVE TP10 vs TP15 + rank S2 | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
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

  /** @type {any[]} */
  const tp10 = [];
  /** @type {any[]} */
  const tp15 = [];
  /** @type {any[]} */
  const tp20 = [];

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
      if (i - last < COOLDOWN_BARS) continue;

      const day = new Date(t).toISOString().slice(0, 10);
      const meta = { sym, day, drop: +dropPct.toFixed(2), rank };
      tp10.push({ ...meta, ...walkSell(c15, i, curr.c, 10) });
      tp15.push({ ...meta, ...walkSell(c15, i, curr.c, 15) });
      tp20.push({ ...meta, ...walkSell(c15, i, curr.c, 20) });
      last = i;
    }
  }
  process.stdout.write('\n');

  const s10 = summarize('LIVE + TP1 −10%@50%', tp10);
  const s15 = summarize('LIVE + TP1 −15%@50%', tp15);
  const s20 = summarize('LIVE + TP1 −20%@50% (ref actual)', tp20);

  const delta = {
    avg: s10.avg - s15.avg,
    usdt: s10.usdt - s15.usdt,
    wr: s10.wr - s15.wr,
  };
  console.log('\nΔ TP10 − TP15:');
  console.log(
    `  avg ${delta.avg >= 0 ? '+' : ''}${delta.avg.toFixed(2)}pp | USDT ${delta.usdt >= 0 ? '+' : ''}${delta.usdt.toFixed(0)} | WR ${delta.wr >= 0 ? '+' : ''}${delta.wr.toFixed(1)}pp`
  );

  // Rank analysis on same entries — use TP15 paths for win/loss (or better: define win by either? Use TP10 for primary win study since user asks winners; also report TP15)
  // Wins differ by TP level. Report rank stats for both, and a shared "entry" view using TP20 (actual) for consistency with live.
  const ranksTp10 = analyzeRanks(tp10, 'TP10');
  const ranksTp15 = analyzeRanks(tp15, 'TP15');
  const ranksTp20 = analyzeRanks(tp20, 'TP20 (actual)');

  // Per-rank exact histogram for winners (TP15 as middle; also TP10)
  function winRankHistogram(trades) {
    const hist = Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, n: 0, usdt: 0 }));
    for (const t of trades.filter((x) => x.pnl >= 0 && x.rank != null)) {
      hist[t.rank - 1].n++;
      hist[t.rank - 1].usdt += (t.pnl * SIZE) / 100;
    }
    return hist.filter((h) => h.n > 0);
  }

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner2_TOP30_24h_reconstruido_4h',
    entry: 'LIVE engolfo (EMA12<EMA21 + fecho<EMA21 + bear + drop≥1%)',
    tp10: s10,
    tp15: s15,
    tp20: s20,
    deltaTp10MinusTp15: delta,
    better: s10.usdt >= s15.usdt ? 'TP10' : 'TP15',
    ranksTp10,
    ranksTp15,
    ranksTp20,
    winRankHistTp10: winRankHistogram(tp10),
    winRankHistTp15: winRankHistogram(tp15),
    winRankHistTp20: winRankHistogram(tp20),
  };

  const path = new URL('./out-engolfo-tp10-vs15-rank.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
  console.log(`\nMelhor entre 10% e 15%: ${out.better}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
