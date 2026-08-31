/**
 * Testa todas as estratégias activas da app no universo Scanner 7 (RSI 14 · 1d > 69)
 * nos últimos 5 dias.
 *
 * Uso (pasta sinais):
 *   node scripts/study-scanner7-all-strategies-5d.mjs
 *   node scripts/study-scanner7-all-strategies-5d.mjs --days=5
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const MIN_QUOTE_VOL = 500_000;
const CANDIDATE_LIMIT = 400;
const RSI7_PERIOD = 14;
const RSI7_THRESHOLD = 69;
const SNAP_MS = 4 * 3600_000;
const BAR_15M = 15 * 60_000;
const BAR_4H = 4 * 3600_000;

const STRATEGIES = [
  {
    id: 'MA_CROSS_5M',
    label: 'MA Cross 12×30 (15m)',
    tf: '15m',
    dirs: ['BUY', 'SELL'],
    sl: 15,
    tp1: 44,
    tp1Pos: 60,
    holdH: 24,
    simplifiedExit: true,
  },
  {
    id: 'MA_CROSS_12X21_S2',
    label: 'MA Cross 12×21 (15m)',
    tf: '15m',
    dirs: ['BUY', 'SELL'],
    sl: 15,
    tp1: 44,
    tp1Pos: 60,
    holdH: 24,
    ma12x21: true,
    simplifiedExit: true,
  },
  {
    id: 'ENGOLFO_15M',
    label: 'engolfo (15m SELL)',
    tf: '15m',
    dirs: ['SELL'],
    sl: 10,
    tp1: 20,
    tp1Pos: 50,
    holdH: 24,
  },
  {
    id: 'ROMPIMENTO_20_15M',
    label: 'Rompimento 20 (15m BUY)',
    tf: '15m',
    dirs: ['BUY'],
    sl: 5,
    tp1: 9,
    tp1Pos: 50,
    holdH: 24,
  },
  {
    id: 'STCH15LONG',
    label: 'stch15long (15m BUY)',
    tf: '15m',
    dirs: ['BUY'],
    sl: 5,
    tp1: 0,
    tp1Pos: 0,
    holdH: 24,
    stochExit: true,
  },
  {
    id: 'SCANNER2_RSI80_TOP3_LONG_4H',
    label: 'Scanner 2 RSI>80 Top 3 LONG (4h)',
    tf: '4h',
    dirs: ['BUY'],
    sl: 10,
    tp1: 0,
    tp1Pos: 0,
    holdH: 24,
    rsiCross: { period: 14, level: 80, dir: 'up' },
  },
  {
    id: 'RSI_VENDIDO_4H',
    label: 'rsi_vendido LONG (4h)',
    tf: '4h',
    dirs: ['BUY'],
    sl: 5,
    tp1: 0,
    tp1Pos: 0,
    holdH: 24,
    rsiCross: { period: 14, entry: 25, exit: 32, dir: 'down' },
  },
];

function parseArgs() {
  const days = parseInt(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? '5', 10);
  return { days: Math.max(1, Math.min(30, days)) };
}

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
  const stepMap = { '15m': BAR_15M, '4h': BAR_4H, '1d': 86400000, '1h': 3600000 };
  const step = stepMap[interval] ?? BAR_15M;
  const out = [];
  let cursor = startMs;
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

function rsiSeries(closes, period) {
  if (closes.length < period + 1) return [];
  const out = new Array(closes.length).fill(null);
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
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function stochSeries(highs, lows, closes, kLen, kSmooth, dSmooth) {
  const rawK = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kLen - 1) {
      rawK.push(null);
      continue;
    }
    const hh = Math.max(...highs.slice(i - kLen + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kLen + 1, i + 1));
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const smooth = (arr, p) => {
    const o = new Array(arr.length).fill(null);
    for (let i = p - 1; i < arr.length; i++) {
      let s = 0;
      let n = 0;
      for (let j = i - p + 1; j <= i; j++) {
        if (arr[j] != null) {
          s += arr[j];
          n++;
        }
      }
      o[i] = n ? s / n : null;
    }
    return o;
  };
  const k = smooth(rawK, kSmooth);
  const d = smooth(k, dSmooth);
  return { k, d };
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

/** Map<snapTs, Set<symbol>> — Scanner 7 membership */
function buildScanner7Snapshots(dailyBySym, startMs, endMs) {
  const snaps = new Map();
  for (let t = alignDown(startMs, SNAP_MS); t <= endMs; t += SNAP_MS) {
    const members = new Set();
    for (const [sym, dCandles] of dailyBySym) {
      const idx = findIdxAtOrBefore(dCandles, t);
      if (idx < RSI7_PERIOD + 1) continue;
      const closed = dCandles.slice(0, idx + 1);
      const closes = closed.map((c) => c.c);
      const rsi = rsiSeries(closes, RSI7_PERIOD);
      const last = rsi[rsi.length - 1];
      if (last != null && last >= RSI7_THRESHOLD) members.add(sym);
    }
    snaps.set(t, members);
  }
  return snaps;
}

function inScanner7(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set?.has(sym) ?? false;
}

function detectMaCross(closed, cfg) {
  const fast = cfg.ma12x21 ? 12 : 12;
  const slow = cfg.ma12x21 ? 21 : 30;
  const entryMin = cfg.ma12x21 ? 0.6 : 0.9;
  const entryMax = cfg.ma12x21 ? 1.5 : 1.8;
  const closes = closed.map((c) => c.c);
  if (closes.length < slow + 3) return null;
  const emaF = emaSeries(closes, fast);
  const emaS = emaSeries(closes, slow);
  const i = closes.length - 1;
  const ip = i - 1;
  const f = emaF[i];
  const s = emaS[i];
  const fp = emaF[ip];
  const sp = emaS[ip];
  if ([f, s, fp, sp].some((x) => x == null)) return null;
  const spread = (Math.abs(f - s) / s) * 100;
  if (!(spread > entryMin && spread < entryMax)) return null;
  if (f > s) return 'BUY';
  if (f < s) return 'SELL';
  return null;
}

function detectEngolfo(closed) {
  if (closed.length < 30) return null;
  const lc = closed.length - 1;
  const prev = closed[lc - 1];
  const curr = closed[lc];
  const dropPct = ((prev.c - curr.c) / prev.c) * 100;
  if (dropPct < 1 || !(curr.c < curr.o)) return null;
  const closes = closed.map((c) => c.c);
  const ef = emaSeries(closes, 12);
  const es = emaSeries(closes, 21);
  const f = ef[lc];
  const s = es[lc];
  if (f == null || s == null) return null;
  const diff = (Math.abs(f - s) / s) * 100;
  if (!(f < s || diff < 2)) return null;
  if (!(curr.c < s)) return null;
  return 'SELL';
}

function detectRompimento(closed) {
  const lookback = 20;
  if (closed.length < lookback + 80) return null;
  const lc = closed.length - 1;
  const curr = closed[lc];
  const range = closed.slice(lc - lookback, lc);
  const rangeHigh = Math.max(...range.map((c) => c.h));
  if (!(curr.c > rangeHigh)) return null;
  const closes = closed.map((c) => c.c);
  const ema70 = emaSeries(closes, 70)[lc];
  if (ema70 == null) return null;
  if (((curr.c - ema70) / ema70) * 100 > 30) return null;
  const highs = closed.map((c) => c.h);
  const lows = closed.map((c) => c.l);
  const { k } = stochSeries(highs, lows, closes, 50, 40, 11);
  if (k[lc] == null || k[lc] >= 30) return null;
  return 'BUY';
}

function detectStochLong(closed, prevClosed) {
  if (closed.length < 40) return null;
  const highs = closed.map((c) => c.h);
  const lows = closed.map((c) => c.l);
  const closes = closed.map((c) => c.c);
  const { k, d } = stochSeries(highs, lows, closes, 20, 15, 11);
  const i = closed.length - 1;
  const ip = i - 1;
  if ([k[i], d[i], k[ip], d[ip]].some((x) => x == null)) return null;
  if (k[ip] <= d[ip] && k[i] > d[i]) return 'BUY';
  return null;
}

function detectStochExit(closed, entryIdx) {
  const highs = closed.map((c) => c.h);
  const lows = closed.map((c) => c.l);
  const closes = closed.map((c) => c.c);
  const { k, d } = stochSeries(highs, lows, closes, 20, 15, 11);
  for (let i = entryIdx + 1; i < closed.length; i++) {
    if (k[i - 1] != null && d[i - 1] != null && k[i] != null && d[i] != null) {
      if (k[i - 1] >= d[i - 1] && k[i] < d[i]) return { idx: i, reason: 'stoch_cross_down' };
    }
  }
  return null;
}

function detectRsiCross(closed, cfg) {
  const closes = closed.map((c) => c.c);
  const rsi = rsiSeries(closes, cfg.period ?? 14);
  const i = closed.length - 1;
  const ip = i - 1;
  if (rsi[i] == null || rsi[ip] == null) return null;
  if (cfg.dir === 'up' && rsi[ip] <= cfg.level && rsi[i] > cfg.level) return 'BUY';
  if (cfg.dir === 'down' && rsi[ip] >= cfg.entry && rsi[i] < cfg.entry) return 'BUY';
  return null;
}

function walkPnl(candles, entryIdx, direction, strat) {
  const entry = candles[entryIdx].c;
  const endT = candles[entryIdx].t + strat.holdH * 3600_000;
  const isBuy = direction === 'BUY';
  const sl = isBuy ? entry * (1 - strat.sl / 100) : entry * (1 + strat.sl / 100);
  const tp1 = strat.tp1 > 0 ? (isBuy ? entry * (1 + strat.tp1 / 100) : entry * (1 - strat.tp1 / 100)) : null;
  let hitTp1 = false;

  if (strat.stochExit) {
    const ex = detectStochExit(candles, entryIdx);
    if (ex) {
      const px = candles[ex.idx].c;
      const pnl = isBuy ? ((px - entry) / entry) * 100 : ((entry - px) / entry) * 100;
      return { pnl: pnl - FEE, path: ex.reason };
    }
  }

  if (strat.rsiCross?.dir === 'down') {
    const closes = candles.map((c) => c.c);
    const rsi = rsiSeries(closes, strat.rsiCross.period ?? 14);
    for (let i = entryIdx + 1; i < candles.length; i++) {
      if (candles[i].t > endT) break;
      if (rsi[i - 1] != null && rsi[i] != null && rsi[i - 1] <= strat.rsiCross.exit && rsi[i] > strat.rsiCross.exit) {
        const px = candles[i].c;
        return { pnl: ((px - entry) / entry) * 100 - FEE, path: 'rsi_exit' };
      }
    }
  }

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) {
      const px = candles[i - 1]?.c ?? b.c;
      const raw = isBuy ? ((px - entry) / entry) * 100 : ((entry - px) / entry) * 100;
      return { pnl: raw - FEE, path: 'time' };
    }
    const hitSl = isBuy ? b.l <= sl : b.h >= sl;
    const hitT1 = tp1 != null && (isBuy ? b.h >= tp1 : b.l <= tp1);
    if (hitSl && hitT1) {
      const pnl = isBuy ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100;
      return { pnl: pnl - FEE, path: 'SL' };
    }
    if (hitSl) {
      const pnl = isBuy ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100;
      return { pnl: pnl - FEE, path: 'SL' };
    }
    if (!hitTp1 && hitT1) hitTp1 = true;
    if (hitTp1 && tp1) {
      const partial = strat.tp1Pos / 100;
      const restPx = b.c;
      const tpPart = isBuy ? ((tp1 - entry) / entry) * 100 : ((entry - tp1) / entry) * 100;
      const restPart = isBuy ? ((restPx - entry) / entry) * 100 : ((entry - restPx) / entry) * 100;
      if (i === candles.length - 1 || candles[i + 1].t > endT) {
        return { pnl: partial * tpPart + (1 - partial) * restPart - FEE, path: 'TP1+time' };
      }
    }
  }
  const last = candles[candles.length - 1].c;
  const raw = isBuy ? ((last - entry) / entry) * 100 : ((entry - last) / entry) * 100;
  return { pnl: raw - FEE, path: 'eod' };
}

function summarize(trades) {
  if (!trades.length) {
    return { n: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, best: 0, worst: 0 };
  }
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0).length;
  return {
    n: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: +((wins / trades.length) * 100).toFixed(1),
    totalPnl: +pnls.reduce((a, b) => a + b, 0).toFixed(2),
    avgPnl: +(pnls.reduce((a, b) => a + b, 0) / trades.length).toFixed(2),
    best: +Math.max(...pnls).toFixed(2),
    worst: +Math.min(...pnls).toFixed(2),
  };
}

async function main() {
  const { days } = parseArgs();
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 3600_000;
  const warmupMs = startMs - 40 * 24 * 3600_000;

  console.log(`\nScanner 7 (RSI ${RSI7_PERIOD} · 1d ≥ ${RSI7_THRESHOLD}) × estratégias activas — últimos ${days} dias\n`);

  const symbols = await candidateSymbols();
  console.log(`Candidatos volume: ${symbols.length}`);

  const dailyBySym = new Map();
  let loaded = 0;
  for (const sym of symbols) {
    try {
      const d = await fetchKlines(sym, '1d', warmupMs, endMs);
      if (d.length >= RSI7_PERIOD + 5) dailyBySym.set(sym, d);
    } catch {
      /* skip */
    }
    loaded++;
    if (loaded % 40 === 0) console.log(`  1d klines: ${loaded}/${symbols.length}`);
    await new Promise((r) => setTimeout(r, 20));
  }

  const snaps = buildScanner7Snapshots(dailyBySym, startMs, endMs);
  const s7Symbols = new Set();
  for (const set of snaps.values()) for (const s of set) s7Symbols.add(s);
  console.log(`Símbolos Scanner 7 (≥1 scan em ${days}d): ${s7Symbols.size}`);
  console.log(`Snapshots 4h: ${snaps.size}\n`);

  if (s7Symbols.size === 0) {
    console.log('Nenhum símbolo no Scanner 7 no período. Execute o scan na app primeiro ou alargue os dias.');
    process.exit(0);
  }

  const klinesBySym = new Map();
  for (const sym of s7Symbols) {
    try {
      const k15 = await fetchKlines(sym, '15m', startMs - 10 * 24 * 3600_000, endMs);
      const k4h = await fetchKlines(sym, '4h', startMs - 10 * 24 * 3600_000, endMs);
      klinesBySym.set(sym, { '15m': k15, '4h': k4h });
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 30));
  }

  const results = [];

  for (const strat of STRATEGIES) {
    const trades = [];
    const step = strat.tf === '4h' ? BAR_4H : BAR_15M;
    const cooldown = new Map();

    for (const sym of s7Symbols) {
      const series = klinesBySym.get(sym)?.[strat.tf];
      if (!series?.length) continue;

      for (let i = 50; i < series.length; i++) {
        const bar = series[i];
        if (bar.t < startMs || bar.t > endMs) continue;
        if (!inScanner7(snaps, bar.t, sym)) continue;

        const closed = series.slice(0, i + 1);
        let dir = null;

        if (strat.id.startsWith('MA_CROSS')) dir = detectMaCross(closed, strat);
        else if (strat.id === 'ENGOLFO_15M') dir = detectEngolfo(closed);
        else if (strat.id === 'ROMPIMENTO_20_15M') dir = detectRompimento(closed);
        else if (strat.id === 'STCH15LONG') dir = detectStochLong(closed);
        else if (strat.rsiCross) dir = detectRsiCross(closed, strat.rsiCross);

        if (!dir || !strat.dirs.includes(dir)) continue;

        const cdKey = `${sym}:${dir}`;
        const last = cooldown.get(cdKey) ?? 0;
        if (bar.t - last < step * 4) continue;
        cooldown.set(cdKey, bar.t);

        const { pnl, path } = walkPnl(series, i, dir, strat);
        trades.push({ sym, dir, t: bar.t, pnl, path });
      }
    }

    const sum = summarize(trades);
    results.push({ strategy: strat.id, label: strat.label, ...sum, trades: trades.slice(0, 30) });
    console.log(
      `${strat.label.padEnd(42)} | n=${String(sum.n).padStart(3)} | WR ${String(sum.winRate).padStart(5)}% | total ${String(sum.totalPnl).padStart(7)}% | avg ${String(sum.avgPnl).padStart(6)}%`
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    scanner7: {
      code: 'UNIVERSE_RSI_ABOVE_69_1D',
      rsiPeriod: RSI7_PERIOD,
      threshold: RSI7_THRESHOLD,
      uniqueSymbols: s7Symbols.size,
      snapshots: snaps.size,
    },
    strategies: results.map(({ trades, ...r }) => r),
    sampleTrades: Object.fromEntries(results.map((r) => [r.strategy, r.trades])),
  };

  const outPath = path.join(__dirname, 'out-scanner7-all-strategies-5d.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nJSON: ${outPath}\n`);

  const ranked = [...results].sort((a, b) => b.totalPnl - a.totalPnl);
  console.log('Ranking por P&L total (%):');
  for (const r of ranked) {
    console.log(`  ${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl}% — ${r.label} (${r.n} trades)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
