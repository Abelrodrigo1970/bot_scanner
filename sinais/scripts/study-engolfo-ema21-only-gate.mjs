/**
 * Backtest: engolfo OLD (EMA12<EMA21 ou spread<2%) vs só fecho < EMA21
 * Scanner 2 | 14d | SL +8% | TP1 −20%@50% | 24h | fee 0,1%
 *
 * Uso: node scripts/study-engolfo-ema21-only-gate.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 150;
const MIN_QUOTE_VOL = 500_000;
const SCANNER2_TOP = 30;
const LOOKBACK_DAYS = 14;
const FROM_DATE = process.env.FROM || null; // e.g. 2026-08-01
const MIN_DROP = 1;
const MAX_MA_DIFF_PCT = 2;
const SL_PCT = 8;
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
    await new Promise((r) => setTimeout(r, 25));
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
    return { label, n: 0, avg: 0, usdt: 0, wr: 0 };
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

function passesMaGate(e12, e21) {
  const stackBear = e12 < e21;
  const diffPct = (Math.abs(e12 - e21) / e21) * 100;
  return stackBear || diffPct < MAX_MA_DIFF_PCT;
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = FROM_DATE
    ? Date.parse(`${FROM_DATE}T00:00:00.000Z`)
    : now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const periodDays = Math.ceil((endMs - startMs) / (24 * 3600 * 1000));
  const warmMs = Math.max(40 * 15 * 60_000, 26 * 3600_000);

  console.log('═'.repeat(88));
  console.log(
    `ENGOLFO: CURRENT vs EMA21-ONLY | Scanner 2 | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)} (${periodDays}d) | SL +${SL_PCT}% TP1 −${TP1_PCT}%@50%`
  );
  console.log('═'.repeat(88));

  const symbols = await candidateSymbols();
  const series = new Map();
  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    process.stdout.write(`\rKlines ${si + 1}/${symbols.length} ${sym.padEnd(14)}`);
    try {
      const c = await fetchKlines(sym, startMs - warmMs, endMs + HOLD_H * 3600_000);
      if (c.length >= 100) series.set(sym, c);
    } catch {
      /* skip */
    }
  }
  process.stdout.write('\n');

  const snaps = buildScanner2Snapshots(series, startMs, endMs);
  const tradesCurrent = [];
  const tradesEma21Only = [];
  const tradesEma21OnlyNotCurrent = [];

  for (const [sym, c15] of series) {
    const closes = c15.map((c) => c.c);
    const e12 = emaSeries(closes, 12);
    const e21 = emaSeries(closes, 21);
    let lastCur = -COOLDOWN_BARS;
    let lastE21 = -COOLDOWN_BARS;

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
      if (!(curr.c < e21[i])) continue;

      const iso = new Date(t).toISOString();
      const maDiff = (Math.abs(e12[i] - e21[i]) / e21[i]) * 100;
      const base = {
        sym,
        iso,
        entry: curr.c,
        drop: +dropPct.toFixed(2),
        maDiff: +maDiff.toFixed(2),
        stack12lt21: e12[i] < e21[i],
      };

      const passCurrent = passesMaGate(e12[i], e21[i]);
      if (passCurrent && i - lastCur >= COOLDOWN_BARS) {
        const ex = walkSell(c15, i, curr.c);
        tradesCurrent.push({ ...base, ...ex });
        lastCur = i;
      }

      if (i - lastE21 >= COOLDOWN_BARS) {
        const ex = walkSell(c15, i, curr.c);
        tradesEma21Only.push({ ...base, ...ex });
        lastE21 = i;
        if (!passCurrent) {
          tradesEma21OnlyNotCurrent.push({ ...base, ...ex });
        }
      }
    }
  }

  const sCur = summarize(
    'CURRENT: fecho<EMA21 + (EMA12<EMA21 OU spread<2%) + bear + drop≥1%',
    tradesCurrent
  );
  const sE21 = summarize('EMA21-ONLY: fecho<EMA21 + bear + drop≥1% (sem gate EMA12)', tradesEma21Only);

  console.log('\n' + '═'.repeat(88));
  console.log('DELTA EMA21-only vs CURRENT:');
  console.log(
    `Trades: +${sE21.n - sCur.n} | Net USDT: ${(sE21.usdt - sCur.usdt).toFixed(0)} | Avg/trade: ${(sE21.avg - sCur.avg).toFixed(2)}%`
  );

  console.log('\nTrades EXTRA em EMA21-only (bloqueados pelo gate EMA12/spread):', tradesEma21OnlyNotCurrent.length);
  const extraSum = tradesEma21OnlyNotCurrent.reduce((a, t) => a + t.pnl, 0);
  console.log(
    `Net dos extras: ${extraSum.toFixed(1)}% sim | USDT ${((extraSum * SIZE) / 100).toFixed(0)} | WR ${(
      (100 * tradesEma21OnlyNotCurrent.filter((t) => t.pnl >= 0).length) /
      (tradesEma21OnlyNotCurrent.length || 1)
    ).toFixed(1)}%`
  );

  const btrExtra = tradesEma21OnlyNotCurrent.filter((t) => t.sym === 'BTRUSDT');
  if (btrExtra.length) {
    console.log('\nBTRUSDT — shorts só com EMA21-only (não passam CURRENT):');
    for (const t of btrExtra) {
      console.log(
        `  ${t.iso.slice(0, 16)} close ${t.entry.toFixed(5)} drop ${t.drop}% maDiff ${t.maDiff}% pnl ${t.pnl.toFixed(2)}% ${t.path}`
      );
    }
  }

  const topExtra = [...tradesEma21OnlyNotCurrent].sort((a, b) => b.pnl - a.pnl).slice(0, 10);
  console.log('\nTop 10 extras (EMA21-only, não CURRENT):');
  for (const t of topExtra) {
    console.log(
      `  ${t.iso.slice(0, 16)} ${t.sym.padEnd(12)} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% drop ${t.drop}% maDiff ${t.maDiff}%`
    );
  }

  const worstExtra = [...tradesEma21OnlyNotCurrent].sort((a, b) => a.pnl - b.pnl).slice(0, 8);
  console.log('\nPior 8 extras:');
  for (const t of worstExtra) {
    console.log(
      `  ${t.iso.slice(0, 16)} ${t.sym.padEnd(12)} ${t.pnl.toFixed(2)}% drop ${t.drop}% maDiff ${t.maDiff}%`
    );
  }

  function bySymbol(trades) {
    const m = new Map();
    for (const t of trades) {
      if (!m.has(t.sym)) m.set(t.sym, { n: 0, sum: 0, wins: 0 });
      const b = m.get(t.sym);
      b.n++;
      b.sum += t.pnl;
      if (t.pnl >= 0) b.wins++;
    }
    return m;
  }

  const curBy = bySymbol(tradesCurrent);
  const e21By = bySymbol(tradesEma21Only);
  const allSyms = new Set([...curBy.keys(), ...e21By.keys()]);

  const rows = [...allSyms].map((sym) => {
    const c = curBy.get(sym) || { n: 0, sum: 0, wins: 0 };
    const e = e21By.get(sym) || { n: 0, sum: 0, wins: 0 };
    const cUsdt = (c.sum * SIZE) / 100;
    const eUsdt = (e.sum * SIZE) / 100;
    return {
      sym,
      curN: c.n,
      curUsdt: cUsdt,
      curAvg: c.n ? c.sum / c.n : 0,
      curWr: c.n ? (100 * c.wins) / c.n : 0,
      e21N: e.n,
      e21Usdt: eUsdt,
      e21Avg: e.n ? e.sum / e.n : 0,
      e21Wr: e.n ? (100 * e.wins) / e.n : 0,
      deltaUsdt: eUsdt - cUsdt,
    };
  });

  rows.sort((a, b) => b.deltaUsdt - a.deltaUsdt);

  console.log('\n' + '═'.repeat(88));
  console.log('POR SÍMBOLO (desde início do período) — ordenado por Δ USDT (EMA21 − CURRENT)');
  console.log('Symbol       | CUR n  USDT   avg%  WR%  | E21 n  USDT   avg%  WR%  | Δ USDT');
  console.log('─'.repeat(88));

  let totCur = 0;
  let totE21 = 0;
  for (const r of rows) {
    totCur += r.curUsdt;
    totE21 += r.e21Usdt;
  }

  const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(0);
  const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);

  for (const r of rows) {
    if (r.curN === 0 && r.e21N === 0) continue;
    console.log(
      `${r.sym.padEnd(12)} | ${String(r.curN).padStart(4)} ${fmt(r.curUsdt).padStart(6)} ${fmtPct(r.curAvg).padStart(6)} ${r.curWr.toFixed(0).padStart(3)} | ${String(r.e21N).padStart(4)} ${fmt(r.e21Usdt).padStart(6)} ${fmtPct(r.e21Avg).padStart(6)} ${r.e21Wr.toFixed(0).padStart(3)} | ${fmt(r.deltaUsdt).padStart(6)}`
    );
  }

  console.log('─'.repeat(88));
  console.log(
    `TOTAL        | ${tradesCurrent.length} ${fmt(totCur).padStart(6)}       | ${tradesEma21Only.length} ${fmt(totE21).padStart(6)}       | ${fmt(totE21 - totCur).padStart(6)}`
  );

  const bestE21 = [...rows].sort((a, b) => b.e21Usdt - a.e21Usdt).slice(0, 15);
  const worstE21 = [...rows].sort((a, b) => a.e21Usdt - b.e21Usdt).slice(0, 15);
  console.log('\nTop 15 símbolos (EMA21-only USDT):');
  for (const r of bestE21) {
    if (r.e21N === 0) continue;
    console.log(`  ${r.sym.padEnd(12)} n=${r.e21N} USDT=${r.e21Usdt >= 0 ? '+' : ''}${r.e21Usdt.toFixed(0)} WR=${r.e21Wr.toFixed(0)}%`);
  }
  console.log('\nPior 15 símbolos (EMA21-only USDT):');
  for (const r of worstE21) {
    if (r.e21N === 0) continue;
    console.log(`  ${r.sym.padEnd(12)} n=${r.e21N} USDT=${r.e21Usdt.toFixed(0)} WR=${r.e21Wr.toFixed(0)}%`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
