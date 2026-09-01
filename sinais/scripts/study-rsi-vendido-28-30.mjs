/**
 * Mergulho: entra RSI 4h cruza abaixo de 30 ou 28;
 * sai cruza acima de 30 ou 32. SL −5%, hold 24h.
 *
 * Uso: node scripts/study-rsi-vendido-28-30.mjs
 */

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const RSI_P = 14;
const SL = 5;
const HOLD_H = 24;
const CANDIDATE_LIMIT = 200;
const MIN_TURNOVER = 500_000;
const LOOKBACK_MS = 14 * 24 * 3600 * 1000;

const COMBOS = [
  { entry: 30, exit: 30 },
  { entry: 30, exit: 32 },
  { entry: 28, exit: 30 },
  { entry: 28, exit: 32 },
];

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
  return (data.result?.list || [])
    .filter((t) => t.symbol?.endsWith('USDT') && !t.symbol.includes('-'))
    .map((t) => ({ symbol: t.symbol, turnover: +t.turnover24h || 0 }))
    .filter((t) => t.turnover >= MIN_TURNOVER)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, CANDIDATE_LIMIT)
    .map((t) => t.symbol);
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
    await new Promise((r) => setTimeout(r, 25));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

function simulate(candles, entryIdx, rsi, exitLevel) {
  const entry = candles[entryIdx].c;
  const endTs = candles[entryIdx].t + 4 * 3600 * 1000 + HOLD_H * 3600 * 1000;
  let maxFav = 0;
  let maxAdv = 0;
  let exitPct = null;
  let path = 'TIME';

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const bar = candles[i];
    if (bar.t > endTs) break;
    const fav = ((bar.h - entry) / entry) * 100;
    const adv = ((entry - bar.l) / entry) * 100;
    if (fav > maxFav) maxFav = fav;
    if (adv > maxAdv) maxAdv = adv;
    if (bar.l <= entry * (1 - SL / 100)) {
      exitPct = -SL;
      path = 'SL';
      break;
    }
    const r0 = rsi[i - 1];
    const r1 = rsi[i];
    if (r0 != null && r1 != null && r0 <= exitLevel && r1 > exitLevel) {
      exitPct = ((bar.c - entry) / entry) * 100;
      path = 'RSI_UP';
      break;
    }
  }
  if (exitPct == null) {
    let close = entry;
    for (let i = entryIdx + 1; i < candles.length; i++) {
      if (candles[i].t > endTs) break;
      close = candles[i].c;
    }
    exitPct = ((close - entry) / entry) * 100;
  }
  return { pnl: exitPct - FEE, path, maxFav, maxAdv, t: candles[entryIdx].t, c: candles[entryIdx].c };
}

function summarize(label, trades) {
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const trim = trades.filter((t) => Math.abs(t.pnl) < 15);
  const tSum = trim.reduce((a, b) => a + b.pnl, 0);
  const byPath = {};
  for (const t of trades) byPath[t.path] = (byPath[t.path] || 0) + 1;
  const s = {
    label,
    n: trades.length,
    avg: trades.length ? sum / trades.length : 0,
    usdt: (sum * SIZE) / 100,
    wr: trades.length ? (100 * wins) / trades.length : 0,
    avgFav: trades.length ? trades.reduce((a, b) => a + b.maxFav, 0) / trades.length : 0,
    avgAdv: trades.length ? trades.reduce((a, b) => a + b.maxAdv, 0) / trades.length : 0,
    byPath,
    nTrim: trim.length,
    avgTrim: trim.length ? tSum / trim.length : 0,
    usdtTrim: (tSum * SIZE) / 100,
  };
  console.log('\n' + '─'.repeat(88));
  console.log(label);
  console.log(
    `n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}% Máx+ ${s.avgFav.toFixed(1)} Máx− ${s.avgAdv.toFixed(1)}`,
    s.byPath
  );
  console.log(
    `  sem |P&L|≥15%: n=${s.nTrim} avg=${s.avgTrim >= 0 ? '+' : ''}${s.avgTrim.toFixed(2)}% USDT=${s.usdtTrim >= 0 ? '+' : ''}${s.usdtTrim.toFixed(0)}`
  );
  return s;
}

async function main() {
  const now = Date.now();
  const t0 = now - LOOKBACK_MS;
  const t1 = now;
  console.log('═'.repeat(88));
  console.log(
    `Mergulho <30/<28 → sair >30/>32 | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );
  console.log('═'.repeat(88));

  const buckets = {};
  for (const c of COMBOS) buckets[`${c.entry}-${c.exit}`] = [];

  const symbols = await topLinearSymbols();
  console.log(`Símbolos: ${symbols.length}`);

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
      if (closed[i].t < t0 || closed[i].t > t1) continue;

      for (const c of COMBOS) {
        if (!(r0 >= c.entry && r1 < c.entry)) continue;
        buckets[`${c.entry}-${c.exit}`].push({
          sym,
          rsi: r1,
          rsiPrev: r0,
          ...simulate(closed, i, rsi, c.exit),
        });
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log('\n');

  const summaries = {};
  for (const c of COMBOS) {
    const k = `${c.entry}-${c.exit}`;
    summaries[k] = summarize(`entrar <${c.entry} → sair >${c.exit}`, buckets[k]);
  }

  const fs = await import('fs');
  fs.writeFileSync(
    'scripts/out-rsi-vendido-28-30.json',
    JSON.stringify({ summaries, buckets }, null, 2)
  );
  console.log('\nJSON: scripts/out-rsi-vendido-28-30.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
