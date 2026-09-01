/**
 * Estudo Rompimento 20 LONG — grelha SL × TP parcial @50%
 *
 * Entrada: Scanner 1 top 20 (SMA200 1h) · fecho 15m > HH20 · EMA70 ≤30%.
 * Sem flip. TP1 @50% | resto 24h | fee 0,1%.
 *
 * SL: 3 / 5 / 7%   TP: 5 / 7 / 9 / 12 / 15%
 *
 * Uso: node scripts/study-rompimento-sl-tp-grid.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE_RT = 0.1;
const SIZE = 100;
const CANDIDATE_LIMIT = 250;
const MIN_QUOTE_VOL = 500_000;
const SCANNER1_TOP = 20;
const LOOKBACK_DAYS = 21;
const LOOKBACK_BARS = 20;
const FILTER_MA = 70;
const MAX_DIST_EMA70 = 30;
const SL_LEVELS = [3, 5, 7];
const TP_LEVELS = [5, 7, 9, 12, 15];
const TP1_POS = 0.5;
const HOLD_H = 24;
const SNAP_MS = 4 * 3600_000;
const SMA200 = 200;

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

async function fetchKlines(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const step = interval === '1h' ? 3600_000 : 15 * 60_000;
  while (cursor < endMs) {
    const url =
      `${BINANCE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}` +
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

function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
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

function lastCloseAtOrBefore(candles, t) {
  const i = findIdxAtOrBefore(candles, t);
  return i >= 0 ? { i, c: candles[i] } : null;
}

function buildScanner1Snapshots(h1BySym, startMs, endMs) {
  const snaps = new Map();
  const smaBySym = new Map();
  for (const [sym, candles] of h1BySym) {
    smaBySym.set(
      sym,
      smaSeries(
        candles.map((c) => c.c),
        SMA200
      )
    );
  }
  const from = alignDown(startMs, SNAP_MS);
  for (let t = from; t <= endMs; t += SNAP_MS) {
    const rows = [];
    for (const [sym, candles] of h1BySym) {
      const hit = lastCloseAtOrBefore(candles, t);
      if (!hit) continue;
      const sma = smaBySym.get(sym)[hit.i];
      if (!(sma > 0) || !(hit.c.c > 0)) continue;
      if (!(hit.c.c > sma)) continue;
      const pct = ((hit.c.c - sma) / sma) * 100;
      rows.push({ sym, abs: Math.abs(pct) });
    }
    rows.sort((a, b) => b.abs - a.abs);
    snaps.set(t, new Set(rows.slice(0, SCANNER1_TOP).map((r) => r.sym)));
  }
  return snaps;
}

function inScanner1(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set ? set.has(sym) : false;
}

function closeAtOrBefore(candles, endT, fromIdx) {
  let last = candles[fromIdx];
  for (let i = fromIdx; i < candles.length; i++) {
    if (candles[i].t <= endT) last = candles[i];
    else break;
  }
  return last;
}

/** Conservador: mesma vela SL vs TP → SL ganha. */
function walkLong(candles, entryIdx, entry, slPct, tpPct) {
  const sl = entry * (1 - slPct / 100);
  const t1 = entry * (1 + tpPct / 100);
  const endT = candles[entryIdx].t + HOLD_H * 3600_000;
  let hitT1 = false;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) break;
    const hitSl = b.l <= sl;
    const hit1 = b.h >= t1;
    if (!hitT1) {
      if (hitSl) return { pnl: -slPct - FEE_RT, path: 'SL' };
      if (hit1) {
        hitT1 = true;
        continue;
      }
    } else if (hitSl) {
      return { pnl: TP1_POS * tpPct + (1 - TP1_POS) * -slPct - FEE_RT, path: 'T1+SL' };
    }
  }

  const last = closeAtOrBefore(candles, endT, entryIdx);
  const closeP = ((last.c - entry) / entry) * 100;
  if (hitT1) {
    return { pnl: TP1_POS * tpPct + (1 - TP1_POS) * closeP - FEE_RT, path: 'T1+24h' };
  }
  return { pnl: closeP - FEE_RT, path: '24h' };
}

function summarize(label, trades) {
  if (!trades.length) {
    return { label, n: 0, avg: 0, usdt: 0, wr: 0, pf: 0, maxDd: 0, byPath: {} };
  }
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const winSum = wins.reduce((a, b) => a + b.pnl, 0);
  const lossSum = losses.reduce((a, b) => a + b.pnl, 0);
  const byPath = {};
  for (const t of trades) byPath[t.path] = (byPath[t.path] || 0) + 1;
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    eq += t.pnl;
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak - eq);
  }
  return {
    label,
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins.length) / trades.length,
    pf: Math.abs(lossSum) > 0 ? winSum / Math.abs(lossSum) : wins.length ? Infinity : 0,
    maxDd,
    winAvg: wins.length ? winSum / wins.length : 0,
    lossAvg: losses.length ? lossSum / losses.length : 0,
    t1Rate: (100 * ((byPath['T1+24h'] || 0) + (byPath['T1+SL'] || 0))) / trades.length,
    slRate: (100 * ((byPath.SL || 0) + (byPath['T1+SL'] || 0))) / trades.length,
    byPath,
  };
}

function keyOf(sl, tp) {
  return `sl${sl}_tp${tp}`;
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warm1h = (SMA200 + 8) * 3600_000;
  const extra = (HOLD_H + 26) * 3600_000;

  console.log('═'.repeat(96));
  console.log(
    `ROMPIMENTO 20 LONG GRID | SL ${SL_LEVELS.join('/')}% × TP ${TP_LEVELS.join('/')}%@50% | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
  );
  console.log('═'.repeat(96));

  const symbols = await candidateSymbols();
  console.log(`Candidatos: ${symbols.length}`);

  console.log('\nFase 1: klines…');
  const h1 = new Map();
  const m15 = new Map();
  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    process.stdout.write(`\r  ${si + 1}/${symbols.length} ${sym.padEnd(16)}`);
    try {
      const [c1, c15] = await Promise.all([
        fetchKlines(sym, '1h', startMs - warm1h, endMs),
        fetchKlines(sym, '15m', startMs - 80 * 15 * 60_000, endMs + extra),
      ]);
      if (c1.length >= SMA200 && c15.length >= LOOKBACK_BARS + FILTER_MA + 10) {
        h1.set(sym, c1);
        m15.set(sym, c15);
      }
    } catch {
      /* skip */
    }
  }
  process.stdout.write('\n');
  console.log(`Séries OK: ${m15.size}`);

  console.log('Fase 2: Scanner 1…');
  const snaps = buildScanner1Snapshots(h1, startMs, endMs);
  console.log(`Snapshots: ${snaps.size}`);

  /** @type {Array<{sym:string, day:string, t:number, i:number, entry:number, candles:any[]}>} */
  const entries = [];
  console.log('Fase 3: entradas (uma amostra para todas as combinações)…');
  let si = 0;
  for (const [sym, c15] of m15) {
    si++;
    process.stdout.write(`\r  ${si}/${m15.size} ${sym.padEnd(16)}`);
    const e70 = emaSeries(
      c15.map((c) => c.c),
      FILTER_MA
    );
    let busyUntil = 0;
    for (let i = FILTER_MA + LOOKBACK_BARS; i < c15.length - 1; i++) {
      const t = c15[i].t;
      if (t < startMs || t > endMs) continue;
      if (t < busyUntil) continue;
      if (!inScanner1(snaps, t, sym)) continue;
      const curr = c15[i];
      if (!(curr.c > 0) || e70[i] == null || !(e70[i] > 0)) continue;
      if (((curr.c - e70[i]) / e70[i]) * 100 > MAX_DIST_EMA70) continue;
      let hh = -Infinity;
      for (let k = i - LOOKBACK_BARS; k < i; k++) hh = Math.max(hh, c15[k].h);
      if (!(hh > 0) || !(curr.c > hh)) continue;
      entries.push({
        sym,
        day: new Date(t).toISOString().slice(0, 10),
        t,
        i,
        entry: curr.c,
        candles: c15,
      });
      busyUntil = t + HOLD_H * 3600_000;
    }
  }
  process.stdout.write('\n');
  console.log(`Entradas: ${entries.length}`);

  const bags = {};
  for (const sl of SL_LEVELS) {
    for (const tp of TP_LEVELS) {
      bags[keyOf(sl, tp)] = [];
    }
  }

  for (const e of entries) {
    for (const sl of SL_LEVELS) {
      for (const tp of TP_LEVELS) {
        const res = walkLong(e.candles, e.i, e.entry, sl, tp);
        bags[keyOf(sl, tp)].push({ sym: e.sym, day: e.day, ...res });
      }
    }
  }

  const summaries = {};
  const ranked = [];
  console.log('\n' + '─'.repeat(96));
  console.log('RESULTADOS  (mesmas entradas em todas as células)');
  console.log('─'.repeat(96));
  for (const sl of SL_LEVELS) {
    for (const tp of TP_LEVELS) {
      const s = summarize(`SL −${sl}% | TP +${tp}%@50%`, bags[keyOf(sl, tp)]);
      summaries[keyOf(sl, tp)] = { sl, tp, ...s };
      ranked.push({ sl, tp, ...s });
      const pf = Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞';
      console.log(
        `SL${sl}% TP${tp}%  n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}% PF=${pf} T1=${s.t1Rate.toFixed(0)}% SL=${s.slRate.toFixed(0)}%  ${JSON.stringify(s.byPath)}`
      );
    }
  }

  ranked.sort((a, b) => b.usdt - a.usdt);
  console.log('\nTOP 5:');
  ranked.slice(0, 5).forEach((r, i) => {
    console.log(
      `  ${i + 1}. SL${r.sl}% TP${r.tp}%  ${r.usdt >= 0 ? '+' : ''}${r.usdt.toFixed(0)} USDT  média ${r.avg.toFixed(2)}%  WR ${r.wr.toFixed(1)}%  PF ${r.pf.toFixed(2)}`
    );
  });

  console.log('\nMatriz USDT (linhas=SL, colunas=TP):');
  console.log(['SL\\TP', ...TP_LEVELS.map((t) => `+${t}%`)].join('\t'));
  for (const sl of SL_LEVELS) {
    const cells = TP_LEVELS.map((tp) => summaries[keyOf(sl, tp)].usdt.toFixed(0));
    console.log([`${sl}%`, ...cells].join('\t'));
  }

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner1_SMA200_1h_top20_reconstruido_4h',
    entry: 'fecho 15m > HH20, filtro EMA70 ≤30%',
    n: entries.length,
    symbolsOk: m15.size,
    slLevels: SL_LEVELS,
    tpLevels: TP_LEVELS,
    tp1Pos: TP1_POS,
    holdH: HOLD_H,
    feeRt: FEE_RT,
    sizeUsdt: SIZE,
    summaries,
    ranked: ranked.map((r) => ({
      sl: r.sl,
      tp: r.tp,
      avg: r.avg,
      usdt: r.usdt,
      wr: r.wr,
      pf: r.pf,
      maxDd: r.maxDd,
      t1Rate: r.t1Rate,
      slRate: r.slRate,
      byPath: r.byPath,
    })),
  };
  const path = new URL('./out-rompimento-sl-tp-grid.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
