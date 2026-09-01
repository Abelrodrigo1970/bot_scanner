/**
 * Estudo Rompimento 20 (15m) — Scanner 1 (SMA200 1h top 20)
 *
 * LONG: fecho 15m > máx. 20 velas anteriores; sem sinal se preço >30% acima EMA70.
 * TP1 +9% / +15% / +19% @ 50% | resto 24h | SL −5%.
 * Se o SL LONG dispara: entra SHORT no preço do SL, mesma lógica (TP 50%, resto 24h, SL 5%).
 *
 * Uso: node scripts/study-rompimento-tp-sl5-flip.mjs
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
const SL_PCT = 5;
const TP_LEVELS = [9, 15, 19];
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
  /** @type {Map<number, Set<string>>} */
  const snaps = new Map();
  const smaBySym = new Map();
  for (const [sym, candles] of h1BySym) {
    smaBySym.set(sym, smaSeries(candles.map((c) => c.c), SMA200));
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

/**
 * LONG walk. Conservative: same-bar SL vs TP → SL wins.
 * @returns {{ pnl: number, path: string, slHit: boolean, slIdx: number|null, slPrice: number|null }}
 */
function walkLong(candles, entryIdx, entry, tpPct) {
  const sl = entry * (1 - SL_PCT / 100);
  const t1 = entry * (1 + tpPct / 100);
  const endT = candles[entryIdx].t + HOLD_H * 3600_000;
  let hitT1 = false;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) break;
    const hitSl = b.l <= sl;
    const hit1 = b.h >= t1;
    if (!hitT1) {
      if (hitSl) {
        return {
          pnl: -SL_PCT - FEE_RT,
          path: 'SL',
          slHit: true,
          slIdx: i,
          slPrice: sl,
        };
      }
      if (hit1) {
        hitT1 = true;
        continue;
      }
    } else if (hitSl) {
      const p1 = tpPct;
      const p2 = -SL_PCT;
      return {
        pnl: TP1_POS * p1 + (1 - TP1_POS) * p2 - FEE_RT,
        path: 'T1+SL',
        slHit: true,
        slIdx: i,
        slPrice: sl,
      };
    }
  }

  const last = closeAtOrBefore(candles, endT, entryIdx);
  const closeP = ((last.c - entry) / entry) * 100;
  if (hitT1) {
    return {
      pnl: TP1_POS * tpPct + (1 - TP1_POS) * closeP - FEE_RT,
      path: 'T1+24h',
      slHit: false,
      slIdx: null,
      slPrice: null,
    };
  }
  return {
    pnl: closeP - FEE_RT,
    path: '24h',
    slHit: false,
    slIdx: null,
    slPrice: null,
  };
}

function walkShort(candles, entryIdx, entry, tpPct) {
  const sl = entry * (1 + SL_PCT / 100);
  const t1 = entry * (1 - tpPct / 100);
  const endT = candles[entryIdx].t + HOLD_H * 3600_000;
  let hitT1 = false;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) break;
    const hitSl = b.h >= sl;
    const hit1 = b.l <= t1;
    if (!hitT1) {
      if (hitSl) return { pnl: -SL_PCT - FEE_RT, path: 'SL' };
      if (hit1) {
        hitT1 = true;
        continue;
      }
    } else if (hitSl) {
      return {
        pnl: TP1_POS * tpPct + (1 - TP1_POS) * -SL_PCT - FEE_RT,
        path: 'T1+SL',
      };
    }
  }

  const last = closeAtOrBefore(candles, endT, entryIdx);
  const closeP = ((entry - last.c) / entry) * 100;
  if (hitT1) {
    return { pnl: TP1_POS * tpPct + (1 - TP1_POS) * closeP - FEE_RT, path: 'T1+24h' };
  }
  return { pnl: closeP - FEE_RT, path: '24h' };
}

function combine(longRes, shortRes) {
  if (!shortRes) {
    return {
      pnl: longRes.pnl,
      path: `L:${longRes.path}`,
      flipped: false,
      longPnl: longRes.pnl,
      shortPnl: 0,
    };
  }
  return {
    pnl: longRes.pnl + shortRes.pnl,
    path: `L:${longRes.path}|S:${shortRes.path}`,
    flipped: true,
    longPnl: longRes.pnl,
    shortPnl: shortRes.pnl,
  };
}

function summarize(label, trades) {
  if (!trades.length) {
    return { label, n: 0, avg: 0, usdt: 0, wr: 0, pf: 0, maxDd: 0, flips: 0, byPath: {} };
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
  const s = {
    label,
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins.length) / trades.length,
    pf: Math.abs(lossSum) > 0 ? winSum / Math.abs(lossSum) : wins.length ? Infinity : 0,
    maxDd,
    flips: trades.filter((t) => t.flipped).length,
    winAvg: wins.length ? winSum / wins.length : 0,
    lossAvg: losses.length ? lossSum / losses.length : 0,
    byPath,
  };
  const pfStr = Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞';
  console.log('\n' + '─'.repeat(92));
  console.log(label);
  console.log(
    `n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}% PF=${pfStr} DD=${s.maxDd.toFixed(1)} flips=${s.flips}`,
    s.byPath
  );
  return s;
}

function byDayRows(trades) {
  const byDay = {};
  for (const t of trades) {
    if (!byDay[t.day]) byDay[t.day] = { n: 0, sum: 0, flips: 0 };
    byDay[t.day].n++;
    byDay[t.day].sum += t.pnl;
    if (t.flipped) byDay[t.day].flips++;
  }
  return Object.keys(byDay)
    .sort()
    .map((d) => ({
      d,
      n: byDay[d].n,
      flips: byDay[d].flips,
      sum: +byDay[d].sum.toFixed(2),
      usdt: +((byDay[d].sum * SIZE) / 100).toFixed(2),
    }));
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warm1h = (SMA200 + 8) * 3600_000;
  const extra = (HOLD_H + 26) * 3600_000;

  console.log('═'.repeat(92));
  console.log(
    `ROMPIMENTO 20 | TP ${TP_LEVELS.join('/')}% @50% | SL ${SL_PCT}% | flip SHORT no SL | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
  );
  console.log('═'.repeat(92));

  const symbols = await candidateSymbols();
  console.log(`Candidatos: ${symbols.length}`);

  console.log('\nFase 1: klines 1h + 15m…');
  /** @type {Map<string, any[]>} */
  const h1 = new Map();
  /** @type {Map<string, any[]>} */
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

  console.log('Fase 2: snapshots Scanner 1 (SMA200 1h, 4h)…');
  const snaps = buildScanner1Snapshots(h1, startMs, endMs);
  console.log(`Snapshots: ${snaps.size}`);

  /** @type {Record<number, any[]>} */
  const bagsNoFlip = Object.fromEntries(TP_LEVELS.map((tp) => [tp, []]));
  /** @type {Record<number, any[]>} */
  const bagsFlip = Object.fromEntries(TP_LEVELS.map((tp) => [tp, []]));
  /** @type {Record<number, any[]>} */
  const bagsShortOnly = Object.fromEntries(TP_LEVELS.map((tp) => [tp, []]));

  console.log('Fase 3: sinais…');
  let si = 0;
  for (const [sym, c15] of m15) {
    si++;
    process.stdout.write(`\r  ${si}/${m15.size} ${sym.padEnd(16)}`);
    const closes = c15.map((c) => c.c);
    const e70 = emaSeries(closes, FILTER_MA);
    /** last occupied until (ms) per TP — one open trade at a time */
    const busyUntil = Object.fromEntries(TP_LEVELS.map((tp) => [tp, 0]));

    for (let i = FILTER_MA + LOOKBACK_BARS; i < c15.length - 1; i++) {
      const t = c15[i].t;
      if (t < startMs || t > endMs) continue;
      if (!inScanner1(snaps, t, sym)) continue;

      const curr = c15[i];
      if (!(curr.c > 0)) continue;
      if (e70[i] == null || !(e70[i] > 0)) continue;
      const dist = ((curr.c - e70[i]) / e70[i]) * 100;
      if (dist > MAX_DIST_EMA70) continue;

      let hh = -Infinity;
      for (let k = i - LOOKBACK_BARS; k < i; k++) hh = Math.max(hh, c15[k].h);
      if (!(hh > 0) || !(curr.c > hh)) continue;

      const day = new Date(t).toISOString().slice(0, 10);
      const meta = { sym, day, t };

      for (const tp of TP_LEVELS) {
        if (t < busyUntil[tp]) continue;
        const longRes = walkLong(c15, i, curr.c, tp);
        const longTrade = { ...meta, ...longRes, flipped: false, longPnl: longRes.pnl, shortPnl: 0 };
        bagsNoFlip[tp].push(longTrade);

        let shortRes = null;
        if (longRes.slHit && longRes.slIdx != null && longRes.slPrice != null) {
          shortRes = walkShort(c15, longRes.slIdx, longRes.slPrice, tp);
          bagsShortOnly[tp].push({
            ...meta,
            ...shortRes,
            flipped: true,
            longPnl: longRes.pnl,
            shortPnl: shortRes.pnl,
          });
        }
        const combo = combine(longRes, shortRes);
        bagsFlip[tp].push({ ...meta, ...combo });

        const holdMs =
          combo.flipped
            ? HOLD_H * 3600_000 + (c15[longRes.slIdx].t - t)
            : HOLD_H * 3600_000;
        busyUntil[tp] = t + holdMs;
      }
    }
  }
  process.stdout.write('\n');

  /** @type {Record<string, any>} */
  const summaries = {};
  for (const tp of TP_LEVELS) {
    summaries[`long_tp${tp}`] = summarize(
      `LONG only | TP +${tp}%@50% | SL −${SL_PCT}% | resto 24h`,
      bagsNoFlip[tp]
    );
    summaries[`flip_tp${tp}`] = summarize(
      `LONG + SHORT no SL | TP ±${tp}%@50% | SL 5% | resto 24h`,
      bagsFlip[tp]
    );
    summaries[`short_tp${tp}`] = summarize(
      `SHORT (só os flips) | TP −${tp}%@50% | SL +${SL_PCT}%`,
      bagsShortOnly[tp]
    );
  }

  const rankedFlip = TP_LEVELS.map((tp) => ({ tp, ...summaries[`flip_tp${tp}`] })).sort(
    (a, b) => b.usdt - a.usdt
  );
  console.log(
    `\nMelhor com flip: TP ${rankedFlip[0].tp}%  USDT ${rankedFlip[0].usdt.toFixed(0)}  média ${rankedFlip[0].avg.toFixed(2)}%`
  );

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    universe: 'Scanner1_SMA200_1h_top20_reconstruido_4h',
    entry: 'fecho 15m > HH20, filtro EMA70 ≤30%',
    slPct: SL_PCT,
    tp1Pos: TP1_POS,
    holdH: HOLD_H,
    feeRt: FEE_RT,
    sizeUsdt: SIZE,
    symbolsOk: m15.size,
    summaries,
    rankedFlip: rankedFlip.map((r) => ({ tp: r.tp, n: r.n, avg: r.avg, usdt: r.usdt, wr: r.wr, pf: r.pf })),
    byDay: Object.fromEntries(TP_LEVELS.map((tp) => [String(tp), byDayRows(bagsFlip[tp])])),
  };

  const path = new URL('./out-rompimento-tp-sl5-flip.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
