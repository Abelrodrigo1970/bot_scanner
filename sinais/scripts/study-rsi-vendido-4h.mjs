/**
 * Estudo rsi_vendido — RSI(14) 4h cruza abaixo de 32.
 * Universo: top N perpétuos USDT por volume (Bybit), alinhado ao scanner.
 *
 * LONG bounce: entra no cruzamento <32, sai no cruzamento >32 / SL / 24h
 * SHORT dump: entra no cruzamento <32, hold 24h / SL
 *
 * Uso: node scripts/study-rsi-vendido-4h.mjs
 */

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const RSI_P = 14;
const LEVEL = 32;
const HOLD_H = 24;
const SL_LONG = 5;
const SL_SHORT = 7;
const CANDIDATE_LIMIT = 200;
const MIN_TURNOVER = 500_000;
const LOOKBACK_MS = 14 * 24 * 3600 * 1000;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
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

async function topLinearSymbols() {
  const data = await fetchJson(`${BYBIT}/v5/market/tickers?category=linear`);
  const list = (data.result?.list || [])
    .filter((t) => t.symbol?.endsWith('USDT') && !t.symbol.includes('-'))
    .map((t) => ({
      symbol: t.symbol,
      turnover: +t.turnover24h || 0,
    }))
    .filter((t) => t.turnover >= MIN_TURNOVER)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, CANDIDATE_LIMIT);
  return list.map((t) => t.symbol);
}

async function fetch4h(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const step = 4 * 3600 * 1000;
  while (cursor < endMs) {
    const data = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=240&start=${cursor}&limit=1000`
    );
    const list = (data.result?.list || [])
      .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }))
      .sort((a, b) => a.t - b.t);
    if (!list.length) break;
    for (const c of list) if (c.t >= startMs && c.t <= endMs) out.push(c);
    const last = list[list.length - 1].t;
    if (last + step <= cursor) break;
    cursor = last + step;
    if (list.length < 1000) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

function walkExit(candles, entryIdx, direction, slPct, rsi, exitRsi, holdH) {
  const entry = candles[entryIdx].c;
  const entryTs = candles[entryIdx].t + 4 * 3600 * 1000;
  const endTs = entryTs + holdH * 3600 * 1000;
  let maxFav = 0;
  let maxAdv = 0;
  let exitPct = null;
  let path = 'TIME';

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const bar = candles[i];
    if (bar.t > endTs) break;
    if (direction === 'BUY') {
      const fav = ((bar.h - entry) / entry) * 100;
      const adv = ((entry - bar.l) / entry) * 100;
      if (fav > maxFav) maxFav = fav;
      if (adv > maxAdv) maxAdv = adv;
      if (bar.l <= entry * (1 - slPct / 100)) {
        exitPct = -slPct;
        path = 'SL';
        break;
      }
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (exitRsi != null && r0 != null && r1 != null && r0 <= exitRsi && r1 > exitRsi) {
        exitPct = ((bar.c - entry) / entry) * 100;
        path = 'RSI_UP';
        break;
      }
    } else {
      const fav = ((entry - bar.l) / entry) * 100;
      const adv = ((bar.h - entry) / entry) * 100;
      if (fav > maxFav) maxFav = fav;
      if (adv > maxAdv) maxAdv = adv;
      if (bar.h >= entry * (1 + slPct / 100)) {
        exitPct = -slPct;
        path = 'SL';
        break;
      }
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (exitRsi != null && r0 != null && r1 != null && r0 >= exitRsi && r1 < exitRsi) {
        exitPct = ((entry - bar.c) / entry) * 100;
        path = 'RSI_DOWN';
        break;
      }
    }
  }

  if (exitPct == null) {
    let close = entry;
    for (let i = entryIdx + 1; i < candles.length; i++) {
      if (candles[i].t > endTs) break;
      close = candles[i].c;
    }
    exitPct =
      direction === 'BUY' ? ((close - entry) / entry) * 100 : ((entry - close) / entry) * 100;
  }
  return { pnl: exitPct - FEE, path, maxFav, maxAdv };
}

function summarize(label, trades) {
  if (!trades.length) {
    console.log(`\n${label}: 0 trades`);
    return { label, n: 0, avg: 0, usdt: 0, wr: 0 };
  }
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const avgFav = trades.reduce((a, b) => a + b.maxFav, 0) / trades.length;
  const avgAdv = trades.reduce((a, b) => a + b.maxAdv, 0) / trades.length;
  const byPath = {};
  for (const t of trades) byPath[t.path] = (byPath[t.path] || 0) + 1;
  const s = {
    label,
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins) / trades.length,
    avgFav,
    avgAdv,
    byPath,
  };
  console.log('\n' + '─'.repeat(88));
  console.log(label);
  console.log(
    `n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}% Máx+ ${s.avgFav.toFixed(1)} Máx− ${s.avgAdv.toFixed(1)}`,
    s.byPath
  );
  return s;
}

async function main() {
  const now = Date.now();
  const t0 = now - LOOKBACK_MS;
  const t1 = now;
  console.log('═'.repeat(88));
  console.log(`Estudo rsi_vendido — RSI(14) 4h cruza < ${LEVEL} | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`);
  console.log(`Top ${CANDIDATE_LIMIT} volume | LONG SL −${SL_LONG}% | SHORT SL +${SL_SHORT}% | hold ${HOLD_H}h | fee ${FEE}%`);
  console.log('═'.repeat(88));

  const symbols = await topLinearSymbols();
  console.log(`Símbolos: ${symbols.length}`);

  const long24 = [];
  const longFlip = [];
  const short24 = [];
  const shortFlip = [];

  let si = 0;
  for (const sym of symbols) {
    si++;
    process.stdout.write(`\r${si}/${symbols.length} ${sym.padEnd(16)}`);
    let candles;
    try {
      candles = await fetch4h(sym, t0 - 20 * 4 * 3600 * 1000, t1 + HOLD_H * 3600 * 1000);
    } catch {
      continue;
    }
    const closed = candles.filter((c) => c.t + 4 * 3600 * 1000 <= now);
    if (closed.length < RSI_P + 10) continue;
    const rsi = rsiSeries(
      closed.map((c) => c.c),
      RSI_P
    );

    for (let i = 1; i < closed.length; i++) {
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (r0 == null || r1 == null) continue;
      if (!(r0 >= LEVEL && r1 < LEVEL)) continue;
      if (closed[i].t < t0 || closed[i].t > t1) continue;

      long24.push({
        sym,
        rsi: r1,
        t: closed[i].t,
        ...walkExit(closed, i, 'BUY', SL_LONG, rsi, null, HOLD_H),
      });
      longFlip.push({
        sym,
        rsi: r1,
        t: closed[i].t,
        ...walkExit(closed, i, 'BUY', SL_LONG, rsi, LEVEL, HOLD_H),
      });
      short24.push({
        sym,
        rsi: r1,
        t: closed[i].t,
        ...walkExit(closed, i, 'SELL', SL_SHORT, rsi, null, HOLD_H),
      });
      shortFlip.push({
        sym,
        rsi: r1,
        t: closed[i].t,
        ...walkExit(closed, i, 'SELL', SL_SHORT, rsi, LEVEL, HOLD_H),
      });
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  console.log('\n');

  const sL24 = summarize('LONG 24h / SL −5% (cruzar <32)', long24);
  const sLFlip = summarize('LONG até RSI>32 / SL −5% / 24h', longFlip);
  const sS24 = summarize('SHORT 24h / SL +7% (cruzar <32)', short24);
  const sSFlip = summarize('SHORT até RSI>32 / SL +7% / 24h', shortFlip);

  // RSI buckets for short 24h (momentum candidate) and long flip
  function buckets(trades, label) {
    const cuts = [
      [0, 20, '<20'],
      [20, 25, '20–25'],
      [25, 28, '25–28'],
      [28, 32, '28–32'],
    ];
    console.log(`\nPor RSI entrada (${label}):`);
    for (const [lo, hi, name] of cuts) {
      const g = trades.filter((t) => t.rsi >= lo && t.rsi < hi);
      if (!g.length) continue;
      const sum = g.reduce((a, b) => a + b.pnl, 0);
      console.log(
        `  ${name} n=${g.length} avg=${(sum / g.length >= 0 ? '+' : '') + (sum / g.length).toFixed(2)}% USDT=${(sum >= 0 ? '+' : '') + sum.toFixed(0)}`
      );
    }
  }
  buckets(longFlip, 'LONG flip');
  buckets(short24, 'SHORT 24h');

  const fs = await import('fs');
  fs.writeFileSync(
    'scripts/out-rsi-vendido-4h.json',
    JSON.stringify({ sL24, sLFlip, sS24, sSFlip, long24, longFlip, short24, shortFlip }, null, 2)
  );
  console.log('\nJSON: scripts/out-rsi-vendido-4h.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
