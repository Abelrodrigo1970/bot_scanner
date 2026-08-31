/**
 * MA Cross 12×21 (15m) — compara universo actual (Scanner 2 top 30 subidas 24h)
 * vs Scanner 7 (RSI 14 · 1d ≥ 69) no mesmo período.
 *
 * Uso:
 *   node scripts/study-ma-cross-12x21-universe-compare-5d.mjs
 *   node scripts/study-ma-cross-12x21-universe-compare-5d.mjs --days=5
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const MIN_QUOTE_VOL = 500_000;
const CANDIDATE_LIMIT = 400;
const SCANNER2_TOP = 30;
const RSI7_PERIOD = 14;
const RSI7_THRESHOLD = 69;
const SNAP_MS = 4 * 3600_000;
const BAR_15M = 15 * 60_000;

const STRAT = {
  sl: 15,
  tp1: 44,
  tp1Pos: 60,
  holdH: 24,
  entryMin: 0.6,
  entryMax: 1.5,
};

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
  const step = interval === '1d' ? 86400000 : BAR_15M;
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
    await new Promise((r) => setTimeout(r, 20));
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

/** Scanner 2: top 30 subidas 24h (só retorno positivo). */
function buildScanner2Snapshots(k15BySym, startMs, endMs) {
  const snaps = new Map();
  for (let t = alignDown(startMs, SNAP_MS); t <= endMs; t += SNAP_MS) {
    const rows = [];
    for (const [sym, candles] of k15BySym) {
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
    const members = new Set(rows.slice(0, SCANNER2_TOP).map((r) => r.sym));
    snaps.set(t, members);
  }
  return snaps;
}

/** Scanner 7: RSI(14) 1d ≥ 69. */
function buildScanner7Snapshots(dailyBySym, startMs, endMs) {
  const snaps = new Map();
  for (let t = alignDown(startMs, SNAP_MS); t <= endMs; t += SNAP_MS) {
    const members = new Set();
    for (const [sym, dCandles] of dailyBySym) {
      const idx = findIdxAtOrBefore(dCandles, t);
      if (idx < RSI7_PERIOD + 1) continue;
      const closes = dCandles.slice(0, idx + 1).map((c) => c.c);
      const rsi = rsiSeries(closes, RSI7_PERIOD);
      const last = rsi[rsi.length - 1];
      if (last != null && last >= RSI7_THRESHOLD) members.add(sym);
    }
    snaps.set(t, members);
  }
  return snaps;
}

function inUniverse(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set?.has(sym) ?? false;
}

function detectMaCross12x21(closed) {
  const closes = closed.map((c) => c.c);
  if (closes.length < 30) return null;
  const ema12 = emaSeries(closes, 12);
  const ema21 = emaSeries(closes, 21);
  const i = closes.length - 1;
  const f = ema12[i];
  const s = ema21[i];
  if (f == null || s == null) return null;
  const spread = (Math.abs(f - s) / s) * 100;
  if (!(spread > STRAT.entryMin && spread < STRAT.entryMax)) return null;
  if (f > s) return 'BUY';
  if (f < s) return 'SELL';
  return null;
}

function walkPnl(candles, entryIdx, direction) {
  const entry = candles[entryIdx].c;
  const endT = candles[entryIdx].t + STRAT.holdH * 3600_000;
  const isBuy = direction === 'BUY';
  const sl = isBuy ? entry * (1 - STRAT.sl / 100) : entry * (1 + STRAT.sl / 100);
  const tp1 = isBuy ? entry * (1 + STRAT.tp1 / 100) : entry * (1 - STRAT.tp1 / 100);
  let hitTp1 = false;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) {
      const px = candles[i - 1]?.c ?? b.c;
      const raw = isBuy ? ((px - entry) / entry) * 100 : ((entry - px) / entry) * 100;
      return { pnl: raw - FEE, path: 'time' };
    }
    const hitSl = isBuy ? b.l <= sl : b.h >= sl;
    const hitT1 = isBuy ? b.h >= tp1 : b.l <= tp1;
    if (hitSl && hitT1) {
      const pnl = isBuy ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100;
      return { pnl: pnl - FEE, path: 'SL' };
    }
    if (hitSl) {
      const pnl = isBuy ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100;
      return { pnl: pnl - FEE, path: 'SL' };
    }
    if (!hitTp1 && hitT1) hitTp1 = true;
    if (hitTp1) {
      const partial = STRAT.tp1Pos / 100;
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
    return { n: 0, wins: 0, winRate: 0, totalPnl: 0, avgPnl: 0, buyN: 0, sellN: 0, buyAvg: 0, sellAvg: 0 };
  }
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0).length;
  const buys = trades.filter((t) => t.dir === 'BUY');
  const sells = trades.filter((t) => t.dir === 'SELL');
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b.pnl, 0) / arr.length : 0);
  return {
    n: trades.length,
    wins,
    winRate: +((wins / trades.length) * 100).toFixed(1),
    totalPnl: +pnls.reduce((a, b) => a + b, 0).toFixed(2),
    avgPnl: +(pnls.reduce((a, b) => a + b, 0) / trades.length).toFixed(2),
    buyN: buys.length,
    sellN: sells.length,
    buyAvg: +avg(buys).toFixed(2),
    sellAvg: +avg(sells).toFixed(2),
  };
}

function runBacktest(symbols, k15BySym, snaps, startMs, endMs) {
  const trades = [];
  const cooldown = new Map();

  for (const sym of symbols) {
    const series = k15BySym.get(sym);
    if (!series?.length) continue;

    for (let i = 50; i < series.length; i++) {
      const bar = series[i];
      if (bar.t < startMs || bar.t > endMs) continue;
      if (!inUniverse(snaps, bar.t, sym)) continue;

      const dir = detectMaCross12x21(series.slice(0, i + 1));
      if (!dir) continue;

      const cdKey = `${sym}:${dir}`;
      const last = cooldown.get(cdKey) ?? 0;
      if (bar.t - last < BAR_15M * 4) continue;
      cooldown.set(cdKey, bar.t);

      const { pnl, path } = walkPnl(series, i, dir);
      trades.push({ sym, dir, t: bar.t, pnl, path });
    }
  }
  return trades;
}

async function main() {
  const { days } = parseArgs();
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 3600_000;
  const warmupMs = startMs - 40 * 24 * 3600_000;

  console.log(`\nMA Cross 12×21 (15m) — comparar universos · últimos ${days} dias\n`);
  console.log(`Regras: spread EMA12/21 0,6–1,5% · SL 15% · TP1 44% (60%) · resto 24h · fee ${FEE}%\n`);

  const candidates = await candidateSymbols();
  console.log(`A carregar klines (${candidates.length} candidatos)...`);

  const k15BySym = new Map();
  const dailyBySym = new Map();
  let n = 0;
  for (const sym of candidates) {
    try {
      const k15 = await fetchKlines(sym, '15m', warmupMs, endMs);
      const k1d = await fetchKlines(sym, '1d', warmupMs, endMs);
      if (k15.length >= 100) k15BySym.set(sym, k15);
      if (k1d.length >= RSI7_PERIOD + 5) dailyBySym.set(sym, k1d);
    } catch {
      /* skip */
    }
    n++;
    if (n % 50 === 0) console.log(`  ${n}/${candidates.length}`);
    await new Promise((r) => setTimeout(r, 15));
  }

  const snapsS2 = buildScanner2Snapshots(k15BySym, startMs, endMs);
  const snapsS7 = buildScanner7Snapshots(dailyBySym, startMs, endMs);

  const symsS2 = new Set();
  const symsS7 = new Set();
  for (const set of snapsS2.values()) for (const s of set) symsS2.add(s);
  for (const set of snapsS7.values()) for (const s of set) symsS7.add(s);

  const overlap = [...symsS2].filter((s) => symsS7.has(s)).length;

  const universes = [
    {
      id: 'scanner2_top30',
      label: 'Scanner 2 — Top 30 subidas 24h (actual)',
      code: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',
      snaps: snapsS2,
      symbols: symsS2,
    },
    {
      id: 'scanner7_rsi69_1d',
      label: 'Scanner 7 — RSI 14 (1d) ≥ 69',
      code: 'UNIVERSE_RSI_ABOVE_69_1D',
      snaps: snapsS7,
      symbols: symsS7,
    },
  ];

  const results = [];
  for (const u of universes) {
    const trades = runBacktest([...u.symbols], k15BySym, u.snaps, startMs, endMs);
    const sum = summarize(trades);
    results.push({ ...u, ...sum, trades: trades.slice(0, 40) });
    console.log(`${u.label}`);
    console.log(
      `  Símbolos únicos: ${u.symbols.size} · Trades: ${sum.n} · WR ${sum.winRate}% · média ${sum.avgPnl}% · total ${sum.totalPnl}%`
    );
    console.log(`  BUY: ${sum.buyN} (média ${sum.buyAvg}%) · SELL: ${sum.sellN} (média ${sum.sellAvg}%)\n`);
  }

  const [s2, s7] = results;
  const winner = s7.avgPnl > s2.avgPnl ? s7 : s2;
  const delta = +(s7.avgPnl - s2.avgPnl).toFixed(2);

  console.log('--- Conclusão ---');
  console.log(`Overlap símbolos S2∩S7: ${overlap} (${symsS2.size} vs ${symsS7.size})`);
  console.log(
    `Média/trade: Scanner 2 ${s2.avgPnl}% vs Scanner 7 ${s7.avgPnl}% → ${delta >= 0 ? '+' : ''}${delta} pp (Scanner 7)`
  );
  if (s7.avgPnl > s2.avgPnl) {
    console.log('Recomendação: Scanner 7 parece mais rentável na média por trade neste período.');
  } else {
    console.log('Recomendação: manter Scanner 2 — melhor média por trade neste período.');
  }

  const out = {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    strategy: 'MA_CROSS_12X21_S2',
    overlapSymbols: overlap,
    universes: results.map(({ snaps, trades, ...r }) => r),
    sampleTrades: Object.fromEntries(results.map((r) => [r.id, r.trades])),
    recommendation:
      s7.avgPnl > s2.avgPnl
        ? 'Considerar migrar MA Cross 12×21 para Scanner 7 (RSI 1d > 69)'
        : 'Manter MA Cross 12×21 no Scanner 2 (Top 30 subidas 24h)',
  };

  const outPath = path.join(__dirname, 'out-ma-cross-12x21-universe-compare-5d.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nJSON: ${outPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
