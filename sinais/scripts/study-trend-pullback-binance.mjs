/**
 * Estudo: Pullback em tendência (TREND_PULLBACK) — Binance USDT-M Futures
 * Regras alinhadas a sinais/lib/scanner.ts
 *
 * ENTRA:
 *  - Regime 1h: preço vs EMA200 + slope EMA200 (10 barras)
 *  - Zona: |preço1h − EMA21_1h| ≤ 0,5×ATR14_1h
 *  - ATR% 15m entre 0,3% e 2,5%
 *  - LONG: close15m > EMA21_15m + vol > MA20 + RSI≤72
 *  - SHORT: close15m < EMA21_15m + vol > MA20 + RSI≥28
 *  - score ≥ minScore e R:R até T2 ≥ 2
 *
 * SAI: SL (swing 10 ou 1,2×ATR) | T1=1R | T2=2R
 *
 * Uso: node scripts/study-trend-pullback-binance.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1; // % round-trip
const SIZE = 100;
const TOP_N = 80;
const MIN_QUOTE_VOL = 5_000_000;
const LOOKBACK_DAYS = 21;
const MIN_SCORE = 6;
const MIN_ATR = 0.3;
const MAX_ATR = 2.5;
const COOLDOWN_BARS_15M = 16; // ~4h entre trades no mesmo símbolo

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function topSymbols() {
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
    .slice(0, TOP_N)
    .map((t) => t.symbol);
}

async function fetchKlines(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const limit = 1500;
  while (cursor < endMs) {
    const url =
      `${BINANCE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=${limit}`;
    const list = await fetchJson(url);
    if (!Array.isArray(list) || !list.length) break;
    for (const r of list) {
      const t = +r[0];
      if (t >= startMs && t <= endMs) {
        out.push({
          t,
          o: +r[1],
          h: +r[2],
          l: +r[3],
          c: +r[4],
          v: +r[5],
        });
      }
    }
    const last = +list[list.length - 1][0];
    const step =
      interval === '1h' ? 3600_000 : interval === '15m' ? 15 * 60_000 : 60_000;
    if (last + step <= cursor) break;
    cursor = last + step;
    if (list.length < limit) break;
    await new Promise((r) => setTimeout(r, 40));
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

function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgG += d;
    else avgL -= d;
  }
  avgG /= period;
  avgL /= period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

/** ATR Wilder */
function atrSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    const pc = candles[i - 1].c;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
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

function lowest(candles, from, to) {
  let m = Infinity;
  for (let i = from; i <= to; i++) m = Math.min(m, candles[i].l);
  return m;
}

function highest(candles, from, to) {
  let m = -Infinity;
  for (let i = from; i <= to; i++) m = Math.max(m, candles[i].h);
  return m;
}

function calcStop(candles15, i, side, atr15, entry) {
  const from = Math.max(0, i - 9);
  if (side === 'LONG') {
    const structure = lowest(candles15, from, i);
    const atrStop = entry - 1.2 * atr15;
    return Math.min(structure, atrStop);
  }
  const structure = highest(candles15, from, i);
  const atrStop = entry + 1.2 * atr15;
  return Math.max(structure, atrStop);
}

function calcTargets(entry, stop, side) {
  const risk = Math.abs(entry - stop);
  if (side === 'LONG') return { t1: entry + risk, t2: entry + 2 * risk, risk };
  return { t1: entry - risk, t2: entry - 2 * risk, risk };
}

function score(regimeOk, inZone, trigger, volumeOk, rrOk) {
  let s = 0;
  if (regimeOk) s += 2;
  if (inZone) s += 2;
  if (trigger) s += 2;
  if (volumeOk) s += 2;
  if (rrOk) s += 2;
  return s;
}

/**
 * Walk exit: SL prioridade se SL e TP na mesma barra (conservador).
 * mode: 't1' | 't2' | 'split' (50% T1 + 50% T2/SL)
 */
function walkExit(candles, entryIdx, side, entry, stop, t1, t2, mode) {
  let hitT1 = false;
  let pnl = null;
  let path = null;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const bar = candles[i];
    if (side === 'LONG') {
      const hitSl = bar.l <= stop;
      const hit1 = bar.h >= t1;
      const hit2 = bar.h >= t2;
      if (mode === 't1') {
        if (hitSl && hit1) {
          pnl = ((stop - entry) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hitSl) {
          pnl = ((stop - entry) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hit1) {
          pnl = ((t1 - entry) / entry) * 100;
          path = 'T1';
          break;
        }
      } else if (mode === 't2') {
        if (hitSl && (hit1 || hit2)) {
          pnl = ((stop - entry) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hitSl) {
          pnl = ((stop - entry) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hit2) {
          pnl = ((t2 - entry) / entry) * 100;
          path = 'T2';
          break;
        }
      } else {
        // split 50/50
        if (!hitT1) {
          if (hitSl && hit1) {
            pnl = ((stop - entry) / entry) * 100;
            path = 'SL';
            break;
          }
          if (hitSl) {
            pnl = ((stop - entry) / entry) * 100;
            path = 'SL';
            break;
          }
          if (hit1) {
            hitT1 = true;
            if (hit2) {
              pnl = 0.5 * ((t1 - entry) / entry) * 100 + 0.5 * ((t2 - entry) / entry) * 100;
              path = 'T1+T2';
              break;
            }
            continue;
          }
        } else {
          if (hitSl && hit2) {
            pnl = 0.5 * ((t1 - entry) / entry) * 100 + 0.5 * ((stop - entry) / entry) * 100;
            path = 'T1+SL';
            break;
          }
          if (hitSl) {
            pnl = 0.5 * ((t1 - entry) / entry) * 100 + 0.5 * ((stop - entry) / entry) * 100;
            path = 'T1+SL';
            break;
          }
          if (hit2) {
            pnl = 0.5 * ((t1 - entry) / entry) * 100 + 0.5 * ((t2 - entry) / entry) * 100;
            path = 'T1+T2';
            break;
          }
        }
      }
    } else {
      const hitSl = bar.h >= stop;
      const hit1 = bar.l <= t1;
      const hit2 = bar.l <= t2;
      if (mode === 't1') {
        if (hitSl && hit1) {
          pnl = ((entry - stop) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hitSl) {
          pnl = ((entry - stop) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hit1) {
          pnl = ((entry - t1) / entry) * 100;
          path = 'T1';
          break;
        }
      } else if (mode === 't2') {
        if (hitSl && (hit1 || hit2)) {
          pnl = ((entry - stop) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hitSl) {
          pnl = ((entry - stop) / entry) * 100;
          path = 'SL';
          break;
        }
        if (hit2) {
          pnl = ((entry - t2) / entry) * 100;
          path = 'T2';
          break;
        }
      } else {
        if (!hitT1) {
          if (hitSl && hit1) {
            pnl = ((entry - stop) / entry) * 100;
            path = 'SL';
            break;
          }
          if (hitSl) {
            pnl = ((entry - stop) / entry) * 100;
            path = 'SL';
            break;
          }
          if (hit1) {
            hitT1 = true;
            if (hit2) {
              pnl = 0.5 * ((entry - t1) / entry) * 100 + 0.5 * ((entry - t2) / entry) * 100;
              path = 'T1+T2';
              break;
            }
            continue;
          }
        } else {
          if (hitSl) {
            pnl = 0.5 * ((entry - t1) / entry) * 100 + 0.5 * ((entry - stop) / entry) * 100;
            path = 'T1+SL';
            break;
          }
          if (hit2) {
            pnl = 0.5 * ((entry - t1) / entry) * 100 + 0.5 * ((entry - t2) / entry) * 100;
            path = 'T1+T2';
            break;
          }
        }
      }
    }
  }

  if (pnl == null) {
    const last = candles[candles.length - 1].c;
    const gross =
      side === 'LONG' ? ((last - entry) / entry) * 100 : ((entry - last) / entry) * 100;
    if (hitT1 && mode === 'split') {
      pnl = 0.5 * ((side === 'LONG' ? t1 - entry : entry - t1) / entry) * 100 + 0.5 * gross;
      path = 'T1+EOD';
    } else {
      pnl = gross;
      path = 'EOD';
    }
  }

  return { pnl: pnl - FEE, path };
}

function find1hIndex(candles1h, t15) {
  // última vela 1h cujo open <= t15
  let lo = 0;
  let hi = candles1h.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles1h[mid].t <= t15) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function summarize(label, trades) {
  if (!trades.length) {
    console.log(`\n${label}: 0 trades`);
    return { label, n: 0, avg: 0, usdt: 0, wr: 0, byPath: {}, bySide: {} };
  }
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl >= 0).length;
  const byPath = {};
  const bySide = { LONG: [], SHORT: [] };
  for (const t of trades) {
    byPath[t.path] = (byPath[t.path] || 0) + 1;
    bySide[t.side].push(t.pnl);
  }
  const sideSum = (arr) =>
    arr.length
      ? {
          n: arr.length,
          sum: +arr.reduce((a, b) => a + b, 0).toFixed(2),
          wr: +((100 * arr.filter((x) => x >= 0).length) / arr.length).toFixed(1),
        }
      : null;
  const s = {
    label,
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins) / trades.length,
    byPath,
    long: sideSum(bySide.LONG),
    short: sideSum(bySide.SHORT),
  };
  console.log('\n' + '─'.repeat(88));
  console.log(label);
  console.log(
    `n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}%`,
    s.byPath
  );
  if (s.long) console.log(`  LONG  n=${s.long.n} sum=${s.long.sum}% WR=${s.long.wr}%`);
  if (s.short) console.log(`  SHORT n=${s.short.n} sum=${s.short.sum}% WR=${s.short.wr}%`);
  return s;
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  // warm-up EMA200 1h
  const warmMs = 220 * 3600 * 1000;

  console.log('═'.repeat(88));
  console.log(
    `TREND_PULLBACK Binance Futures | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
  );
  console.log(
    `Top ${TOP_N} vol≥${(MIN_QUOTE_VOL / 1e6).toFixed(0)}M | fee ${FEE}% | $100 | minScore ${MIN_SCORE}`
  );
  console.log('═'.repeat(88));

  const symbols = await topSymbols();
  console.log(`Símbolos: ${symbols.length}`);

  const tradesT1 = [];
  const tradesT2 = [];
  const tradesSplit = [];
  let scanned = 0;
  let entries = 0;

  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    process.stdout.write(`\r${si + 1}/${symbols.length} ${sym.padEnd(16)}`);
    let c1h;
    let c15;
    try {
      c1h = await fetchKlines(sym, '1h', startMs - warmMs, endMs);
      c15 = await fetchKlines(sym, '15m', startMs - warmMs, endMs + 2 * 24 * 3600 * 1000);
    } catch {
      continue;
    }
    if (c1h.length < 220 || c15.length < 100) continue;
    scanned++;

    const closes1h = c1h.map((c) => c.c);
    const closes15 = c15.map((c) => c.c);
    const vols15 = c15.map((c) => c.v);
    const ema200_1h = emaSeries(closes1h, 200);
    const ema21_1h = emaSeries(closes1h, 21);
    const atr1h = atrSeries(c1h, 14);
    const ema21_15 = emaSeries(closes15, 21);
    const atr15 = atrSeries(c15, 14);
    const rsi15 = rsiSeries(closes15, 14);
    const volMa20 = smaSeries(vols15, 20);

    let lastEntryBar = -COOLDOWN_BARS_15M;

    for (let i = 50; i < c15.length; i++) {
      const t = c15[i].t;
      if (t < startMs || t > endMs) continue;
      if (i - lastEntryBar < COOLDOWN_BARS_15M) continue;

      const i1 = find1hIndex(c1h, t);
      if (i1 < 210) continue;
      if (ema200_1h[i1] == null || ema200_1h[i1 - 10] == null) continue;
      if (ema21_1h[i1] == null || atr1h[i1] == null) continue;
      if (ema21_15[i] == null || atr15[i] == null || rsi15[i] == null || volMa20[i] == null)
        continue;

      const price1h = c1h[i1].c;
      const price15 = c15[i].c;
      const atrPct = (atr15[i] / price15) * 100;
      if (atrPct < MIN_ATR || atrPct > MAX_ATR) continue;

      const longAllowed = price1h > ema200_1h[i1] && ema200_1h[i1] > ema200_1h[i1 - 10];
      const shortAllowed = price1h < ema200_1h[i1] && ema200_1h[i1] < ema200_1h[i1 - 10];
      if (!longAllowed && !shortAllowed) continue;

      const inZone = Math.abs(price1h - ema21_1h[i1]) <= 0.5 * atr1h[i1];
      if (!inZone) continue;

      const volumeOk = vols15[i] > volMa20[i];
      let side = null;
      if (longAllowed && c15[i].c > ema21_15[i] && volumeOk && rsi15[i] <= 72) side = 'LONG';
      if (shortAllowed && c15[i].c < ema21_15[i] && volumeOk && rsi15[i] >= 28) side = 'SHORT';
      if (!side) continue;

      const entry = price15;
      const stop = calcStop(c15, i, side, atr15[i], entry);
      const { t1, t2, risk } = calcTargets(entry, stop, side);
      if (risk <= 0) continue;
      const reward = Math.abs(t2 - entry);
      const rrOk = reward >= 2 * risk;
      const sc = score(true, true, true, volumeOk, rrOk);
      if (sc < MIN_SCORE || !rrOk) continue;

      entries++;
      lastEntryBar = i;

      const day = new Date(t).toISOString().slice(0, 10);
      const base = { sym, side, entry, stop, t1, t2, score: sc, day, atrPct };

      const e1 = walkExit(c15, i, side, entry, stop, t1, t2, 't1');
      const e2 = walkExit(c15, i, side, entry, stop, t1, t2, 't2');
      const es = walkExit(c15, i, side, entry, stop, t1, t2, 'split');
      tradesT1.push({ ...base, ...e1 });
      tradesT2.push({ ...base, ...e2 });
      tradesSplit.push({ ...base, ...es });
    }
  }

  process.stdout.write('\n');
  console.log(`Scanned OK: ${scanned} | entries: ${entries}`);

  const s1 = summarize('Saída T1 (1R) — 100% posição', tradesT1);
  const s2 = summarize('Saída T2 (2R) — 100% posição', tradesT2);
  const ss = summarize('Split 50% T1 + 50% T2 (scanner-like)', tradesSplit);

  const best = [...tradesSplit].sort((a, b) => b.pnl - a.pnl).slice(0, 8);
  const worst = [...tradesSplit].sort((a, b) => a.pnl - b.pnl).slice(0, 8);
  console.log('\nTop wins (split):');
  for (const t of best)
    console.log(
      `  ${t.day} ${t.sym} ${t.side} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} score=${t.score}`
    );
  console.log('Top losses (split):');
  for (const t of worst)
    console.log(
      `  ${t.day} ${t.sym} ${t.side} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} score=${t.score}`
    );

  const byDay = {};
  for (const t of tradesSplit) {
    if (!byDay[t.day]) byDay[t.day] = { n: 0, sum: 0 };
    byDay[t.day].n++;
    byDay[t.day].sum += t.pnl;
  }
  console.log('\nP&L diário (split %):');
  for (const d of Object.keys(byDay).sort()) {
    const x = byDay[d];
    console.log(
      `  ${d} n=${x.n} sum=${x.sum >= 0 ? '+' : ''}${x.sum.toFixed(2)}% USDT=${((x.sum * SIZE) / 100).toFixed(0)}`
    );
  }

  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    exchange: 'binance_usdtm',
    symbols: symbols.length,
    scanned,
    entries,
    feePct: FEE,
    sizeUsdt: SIZE,
    minScore: MIN_SCORE,
    variants: { t1: s1, t2: s2, split: ss },
    best: best.map((t) => ({
      sym: t.sym,
      side: t.side,
      day: t.day,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
    })),
    worst: worst.map((t) => ({
      sym: t.sym,
      side: t.side,
      day: t.day,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
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

  const fs = await import('fs');
  const path = new URL('./out-trend-pullback-binance.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
