/**
 * rsi_qqq LONG+SHORT YTD — todos os perpétuos USDT Bybit (rank por USDT).
 * LONG: RSI SMA18 ↑34 · SL −4% · TP1 +2%@50% · TP2 +5%@50%
 * SHORT: EMA20↓EMA70 · SL +3% · TP −4% · fecha no LONG
 *
 *   node scripts/study-rsi-qqq-universe-ytd.mjs
 *   node scripts/study-rsi-qqq-universe-ytd.mjs --top=100 --cryptoOnly
 *   node scripts/study-rsi-qqq-universe-ytd.mjs --stocksOnly
 *   node scripts/study-rsi-qqq-universe-ytd.mjs --top=200 --minQuote=500000
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const H1 = 60 * 60 * 1000;
const RSI_PERIOD = 14;
const RSI_MA = 18;
const CROSS = 34;
const LONG_SL = 4;
const TP1 = 2;
const TP1_POS = 0.5;
const TP2 = 5;
const EMA_FAST = 20;
const EMA_SLOW = 70;
const SHORT_SL = 3;
const SHORT_TP = 4;
const CONCURRENCY = 8;
const WARM_MS = 40 * 24 * 3600 * 1000;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-01-01T00:00:00.000Z');
const t1 = Date.now();

const topArg = Number(process.argv.find((a) => a.startsWith('--top='))?.split('=')[1] || 0);
const minQuote = Number(
  process.argv.find((a) => a.startsWith('--minQuote='))?.split('=')[1] || 500_000
);
const cryptoOnly = process.argv.includes('--cryptoOnly');
const stocksOnly = process.argv.includes('--stocksOnly');
if (cryptoOnly && stocksOnly) {
  console.error('Usa só --cryptoOnly ou --stocksOnly');
  process.exit(1);
}

const CACHE = path.join(DIR, `cache-rsi-qqq-universe-ytd-1h.json`);
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(
  DIR,
  `out-rsi-qqq-universe-ytd-${stocksOnly ? 'stocks-' : cryptoOnly ? 'crypto-' : ''}${stamp}${topArg ? `-top${topArg}` : ''}.json`
);

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}
function rsiSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
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
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function smaOnSeries(series, period) {
  const out = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    if (series[i] == null) continue;
    let ok = true;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (j < 0 || series[j] == null) {
        ok = false;
        break;
      }
      sum += series[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}
function emaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

async function fetchJson(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

async function fetchStockSymbols() {
  const stocks = new Set();
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const url =
      `${BYBIT}/v5/market/instruments-info?category=linear&limit=1000` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const data = await fetchJson(url);
    for (const i of data.result?.list || []) {
      if (String(i.symbolType || '').toLowerCase() === 'stock') {
        stocks.add(String(i.symbol));
      }
    }
    cursor = data.result?.nextPageCursor || '';
    if (!cursor) break;
  }
  return stocks;
}

async function candidateSymbols() {
  const data = await fetchJson(`${BYBIT}/v5/market/tickers?category=linear`);
  const list = data.result?.list || [];
  const stockSet =
    cryptoOnly || stocksOnly ? await fetchStockSymbols() : new Set();
  if (cryptoOnly) console.log(`Excluídos stocks Bybit: ${stockSet.size}`);
  if (stocksOnly) console.log(`Só stocks Bybit: ${stockSet.size}`);
  let rows = list
    .filter((t) => {
      if (!t.symbol?.endsWith('USDT') || t.symbol.includes('-')) return false;
      if (+t.turnover24h < minQuote) return false;
      if (cryptoOnly && stockSet.has(t.symbol)) return false;
      if (stocksOnly && !stockSet.has(t.symbol)) return false;
      return true;
    })
    .sort((a, b) => +b.turnover24h - +a.turnover24h);
  if (topArg > 0) rows = rows.slice(0, topArg);
  return rows.map((t) => t.symbol);
}

async function fetchKlines(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard++ < 200) {
    const data = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=60&start=${cursor}&limit=1000`
    );
    const list = (data.result?.list || [])
      .map((r) => ({
        t: +r[0],
        o: +r[1],
        h: +r[2],
        l: +r[3],
        c: +r[4],
      }))
      .sort((a, b) => a.t - b.t);
    if (!list.length) break;
    for (const c of list) if (c.t >= startMs && c.t <= endMs) out.push(c);
    const last = list[list.length - 1].t;
    if (last + H1 <= cursor) break;
    cursor = last + H1;
    if (list.length < 1000) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

function simulateLong(bars, entryIdx) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 - LONG_SL / 100);
  const tp1Px = entry * (1 + TP1 / 100);
  const tp2Px = entry * (1 + TP2 / 100);
  let rem = 1;
  let locked = 0;
  let hitTp1 = false;
  let path = 'OPEN';
  let exitT = bars[entryIdx].t;
  let exitPx = entry;
  let exitIdx = entryIdx;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.l <= slPx) {
      locked += rem * -LONG_SL;
      rem = 0;
      path = hitTp1 ? 'TP1+SL' : 'SL';
      exitT = b.t;
      exitPx = slPx;
      exitIdx = i;
      break;
    }
    if (!hitTp1 && b.h >= tp1Px) {
      locked += TP1_POS * TP1;
      rem -= TP1_POS;
      hitTp1 = true;
    }
    if (hitTp1 && rem > 0 && b.h >= tp2Px) {
      locked += rem * TP2;
      rem = 0;
      path = 'TP1+TP2';
      exitT = b.t;
      exitPx = tp2Px;
      exitIdx = i;
      break;
    }
    exitT = b.t;
    exitPx = b.c;
    exitIdx = i;
  }
  if (rem > 0) {
    locked += rem * ((exitPx - entry) / entry) * 100;
    path = hitTp1 ? 'TP1+TIME' : 'TIME';
  }
  return { pnl: locked - FEE, path, exitT, exitIdx };
}

function simulateShort(bars, entryIdx, longSignalIdxs) {
  const entry = bars[entryIdx].c;
  const slPx = entry * (1 + SHORT_SL / 100);
  const tpPx = entry * (1 - SHORT_TP / 100);

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (longSignalIdxs.has(i)) {
      return {
        pnl: ((entry - b.c) / entry) * 100 - FEE,
        path: 'FLIP_LONG',
        exitT: b.t,
        exitIdx: i,
      };
    }
    if (b.h >= slPx) {
      return { pnl: -SHORT_SL - FEE, path: 'SL', exitT: b.t, exitIdx: i };
    }
    if (b.l <= tpPx) {
      return { pnl: SHORT_TP - FEE, path: 'TP', exitT: b.t, exitIdx: i };
    }
  }
  const last = bars[bars.length - 1];
  return {
    pnl: ((entry - last.c) / entry) * 100 - FEE,
    path: 'TIME',
    exitT: last.t,
    exitIdx: bars.length - 1,
  };
}

function runSymbol(symbol, h1) {
  if (!h1 || h1.length < EMA_SLOW + RSI_PERIOD + RSI_MA + 10) {
    return { symbol, n: 0, wins: 0, wr: 0, usdt: 0, avg: 0, longN: 0, shortN: 0, longUsdt: 0, shortUsdt: 0, paths: {}, trades: [] };
  }
  const closes = h1.map((b) => b.c);
  const rsi = rsiSeries(closes, RSI_PERIOD);
  const rsiMa = smaOnSeries(rsi, RSI_MA);
  const emaF = emaSeries(closes, EMA_FAST);
  const emaS = emaSeries(closes, EMA_SLOW);

  const longSignalIdxs = new Set();
  for (let i = 1; i < h1.length; i++) {
    if (h1[i].t < t0 || h1[i].t > t1) continue;
    const curr = rsiMa[i];
    const prev = rsiMa[i - 1];
    if (curr == null || prev == null) continue;
    if (prev < CROSS && curr > prev && curr >= CROSS) longSignalIdxs.add(i);
  }

  const trades = [];
  let busyUntil = 0;

  for (let i = 1; i < h1.length; i++) {
    const bar = h1[i];
    if (bar.t < t0 || bar.t > t1) continue;
    if (busyUntil > bar.t) continue;

    const curr = rsiMa[i];
    const prev = rsiMa[i - 1];
    const longSig =
      curr != null && prev != null && prev < CROSS && curr > prev && curr >= CROSS;

    const ef = emaF[i];
    const efp = emaF[i - 1];
    const es = emaS[i];
    const esp = emaS[i - 1];
    const shortSig =
      ef != null && efp != null && es != null && esp != null && efp >= esp && ef < es;

    if (longSig) {
      const walk = simulateLong(h1, i);
      trades.push({
        symbol,
        side: 'LONG',
        entryAt: iso(bar.t),
        exitAt: iso(walk.exitT),
        path: walk.path,
        usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
      });
      busyUntil = walk.exitT;
      continue;
    }

    if (shortSig) {
      const walk = simulateShort(h1, i, longSignalIdxs);
      trades.push({
        symbol,
        side: 'SHORT',
        entryAt: iso(bar.t),
        exitAt: iso(walk.exitT),
        path: walk.path,
        usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
      });
      if (walk.path === 'FLIP_LONG' && walk.exitIdx >= 0) {
        const longWalk = simulateLong(h1, walk.exitIdx);
        trades.push({
          symbol,
          side: 'LONG',
          entryAt: iso(h1[walk.exitIdx].t),
          exitAt: iso(longWalk.exitT),
          path: longWalk.path,
          usdt: +((longWalk.pnl * SIZE) / 100).toFixed(2),
        });
        busyUntil = longWalk.exitT;
      } else {
        busyUntil = walk.exitT;
      }
    }
  }

  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const longs = trades.filter((t) => t.side === 'LONG');
  const shorts = trades.filter((t) => t.side === 'SHORT');
  const paths = {};
  for (const t of trades) paths[t.path] = (paths[t.path] || 0) + 1;

  return {
    symbol,
    n: trades.length,
    wins,
    wr: trades.length ? +((100 * wins) / trades.length).toFixed(1) : 0,
    usdt: +usdt.toFixed(2),
    avg: trades.length ? +(usdt / trades.length).toFixed(2) : 0,
    longN: longs.length,
    shortN: shorts.length,
    longUsdt: +longs.reduce((a, t) => a + t.usdt, 0).toFixed(2),
    shortUsdt: +shorts.reduce((a, t) => a + t.usdt, 0).toFixed(2),
    paths,
    trades,
  };
}

console.log('═'.repeat(80));
console.log(
  `rsi_qqq universe YTD · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
);
console.log(
  `LONG RSI↑${CROSS} SL−${LONG_SL}% TP ${TP1}/+${TP2} | SHORT EMA${EMA_FAST}↓${EMA_SLOW} SL+${SHORT_SL}% TP−${SHORT_TP}% | minQuote=${minQuote}${topArg ? ` top=${topArg}` : ''}${cryptoOnly ? ' cryptoOnly' : ''}${stocksOnly ? ' stocksOnly' : ''}`
);
console.log('═'.repeat(80));

console.log('A listar símbolos…');
const symbols = await candidateSymbols();
console.log(`Símbolos: ${symbols.length}`);

let klinesBySym = {};
if (existsSync(CACHE)) {
  try {
    const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
    if (cached?.meta?.from === new Date(t0).toISOString().slice(0, 10) && cached.klines) {
      klinesBySym = cached.klines;
      console.log(`Cache hit: ${Object.keys(klinesBySym).length} símbolos`);
    }
  } catch {
    /* ignore */
  }
}

const missing = symbols.filter((s) => !klinesBySym[s] || klinesBySym[s].length < 100);
console.log(`A obter 1h em falta: ${missing.length}…`);
let done = 0;
await mapPool(missing, CONCURRENCY, async (sym) => {
  try {
    const bars = await fetchKlines(sym, t0 - WARM_MS, t1);
    klinesBySym[sym] = bars;
  } catch (e) {
    console.warn(`  fail ${sym}: ${e.message}`);
    klinesBySym[sym] = [];
  }
  done++;
  if (done % 20 === 0 || done === missing.length) {
    console.log(`  klines ${done}/${missing.length}`);
  }
});

writeFileSync(
  CACHE,
  JSON.stringify({
    meta: { from: new Date(t0).toISOString().slice(0, 10), to: new Date(t1).toISOString(), n: symbols.length },
    klines: klinesBySym,
  })
);
console.log(`Cache gravado: ${CACHE}`);

console.log('A simular…');
const rows = symbols.map((sym) => runSymbol(sym, klinesBySym[sym] || []));
const withTrades = rows.filter((r) => r.n > 0);
withTrades.sort((a, b) => b.usdt - a.usdt);

const totalUsdt = withTrades.reduce((a, r) => a + r.usdt, 0);
const totalN = withTrades.reduce((a, r) => a + r.n, 0);
const totalWins = withTrades.reduce((a, r) => a + r.wins, 0);

console.log('\n── RESUMO ──');
console.log(
  `syms=${withTrades.length}/${symbols.length} trades=${totalN} WR=${totalN ? ((100 * totalWins) / totalN).toFixed(1) : 0}% USDT=${totalUsdt >= 0 ? '+' : ''}${totalUsdt.toFixed(1)}`
);

console.log('\nTop 30 por USDT:');
console.log(
  '#'.padStart(3),
  'SYMBOL'.padEnd(14),
  'n'.padStart(4),
  'WR%'.padStart(6),
  'LONG'.padStart(8),
  'SHORT'.padStart(8),
  'USDT'.padStart(9),
  'AVG'.padStart(7)
);
for (const [i, r] of withTrades.slice(0, 30).entries()) {
  console.log(
    String(i + 1).padStart(3),
    r.symbol.padEnd(14),
    String(r.n).padStart(4),
    r.wr.toFixed(1).padStart(6),
    ((r.longUsdt >= 0 ? '+' : '') + r.longUsdt.toFixed(1)).padStart(8),
    ((r.shortUsdt >= 0 ? '+' : '') + r.shortUsdt.toFixed(1)).padStart(8),
    ((r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)).padStart(9),
    ((r.avg >= 0 ? '+' : '') + r.avg.toFixed(2)).padStart(7)
  );
}

console.log('\nPiores 15:');
for (const [i, r] of withTrades.slice(-15).reverse().entries()) {
  console.log(
    String(i + 1).padStart(3),
    r.symbol.padEnd(14),
    String(r.n).padStart(4),
    ((r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(1)).padStart(9)
  );
}

const qqq = rows.find((r) => r.symbol === 'QQQUSDT');
if (qqq) {
  const rank = withTrades.findIndex((r) => r.symbol === 'QQQUSDT') + 1;
  console.log(
    `\nQQQUSDT: rank #${rank || '—'} n=${qqq.n} WR=${qqq.wr}% USDT=${qqq.usdt >= 0 ? '+' : ''}${qqq.usdt}`
  );
}

const ranking = withTrades.map(({ trades, ...r }) => r);
writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        strategy: 'rsi_qqq',
        from: new Date(t0).toISOString(),
        to: new Date(t1).toISOString(),
        symbols: symbols.length,
        withTrades: withTrades.length,
        minQuote,
        topArg: topArg || null,
        cryptoOnly,
        stocksOnly,
        long: { sl: LONG_SL, tp1: TP1, tp2: TP2 },
        short: { emaFast: EMA_FAST, emaSlow: EMA_SLOW, sl: SHORT_SL, tp: SHORT_TP },
        feePct: FEE,
        sizeUsdt: SIZE,
      },
      summary: {
        n: totalN,
        wins: totalWins,
        wr: totalN ? +((100 * totalWins) / totalN).toFixed(1) : 0,
        usdt: +totalUsdt.toFixed(2),
      },
      ranking,
      top30: withTrades.slice(0, 30).map(({ trades, ...r }) => r),
      worst15: withTrades.slice(-15).reverse().map(({ trades, ...r }) => r),
      qqq: qqq ? (({ trades, ...r }) => r)(qqq) : null,
      top30Trades: withTrades.slice(0, 10).flatMap((r) => r.trades),
    },
    null,
    2
  )
);
console.log('\nJSON', OUT);
