/**
 * Estudo: RSI 4h abaixo de 25 → LONG quando cruza acima de 25 → sai acima de 32
 * Uso: node scripts/study-rsi-vendido-25-32.mjs
 */

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const RSI_P = 14;
const ENTRY = 25;
const EXIT = 32;
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
    await new Promise((r) => setTimeout(r, 30));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

function walkExit(candles, entryIdx, slPct, rsi, exitRsi, holdH) {
  const entry = candles[entryIdx].c;
  const endTs = candles[entryIdx].t + 4 * 3600 * 1000 + holdH * 3600 * 1000;
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
    if (slPct > 0 && bar.l <= entry * (1 - slPct / 100)) {
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
  }

  if (exitPct == null) {
    let close = entry;
    for (let i = entryIdx + 1; i < candles.length; i++) {
      if (candles[i].t > endTs) break;
      close = candles[i].c;
    }
    exitPct = ((close - entry) / entry) * 100;
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
  console.log(
    `RSI<${ENTRY} → LONG cruzar >${ENTRY} → sair >${EXIT} | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );
  console.log('═'.repeat(88));

  const symbols = await topLinearSymbols();
  console.log(`Símbolos: ${symbols.length}`);

  const vExit32sl5 = [];
  const vExit32sl3 = [];
  const vExit32sl7 = [];
  const vExit32nosl = [];
  const v24sl5 = [];
  const v48sl5 = [];
  const vExit32h48 = [];

  let si = 0;
  for (const sym of symbols) {
    si++;
    process.stdout.write(`\r${si}/${symbols.length} ${sym.padEnd(16)}`);
    let candles;
    try {
      candles = await fetch4h(sym, t0 - 20 * 4 * 3600 * 1000, t1 + 48 * 3600 * 1000);
    } catch {
      continue;
    }
    const closed = candles.filter((c) => c.t + 4 * 3600 * 1000 <= now);
    if (closed.length < RSI_P + 10) continue;
    const rsi = rsiSeries(
      closed.map((c) => c.c),
      RSI_P
    );

    let wasBelow25 = false;
    for (let i = 1; i < closed.length; i++) {
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (r0 == null || r1 == null) continue;
      if (r1 < ENTRY) wasBelow25 = true;
      if (!wasBelow25) continue;
      if (!(r0 < ENTRY && r1 >= ENTRY)) continue;
      if (closed[i].t < t0 || closed[i].t > t1) continue;

      const base = { sym, rsi: r1, rsiPrev: r0, t: closed[i].t };
      vExit32sl5.push({ ...base, ...walkExit(closed, i, 5, rsi, EXIT, 24) });
      vExit32sl3.push({ ...base, ...walkExit(closed, i, 3, rsi, EXIT, 24) });
      vExit32sl7.push({ ...base, ...walkExit(closed, i, 7, rsi, EXIT, 24) });
      vExit32nosl.push({ ...base, ...walkExit(closed, i, 0, rsi, EXIT, 24) });
      v24sl5.push({ ...base, ...walkExit(closed, i, 5, rsi, null, 24) });
      v48sl5.push({ ...base, ...walkExit(closed, i, 5, rsi, null, 48) });
      vExit32h48.push({ ...base, ...walkExit(closed, i, 5, rsi, EXIT, 48) });
      wasBelow25 = false;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  console.log('\n');

  summarize(`LONG cruzar >${ENTRY} → sair >${EXIT} / SL −5% / 24h`, vExit32sl5);
  summarize(`… SL −3%`, vExit32sl3);
  summarize(`… SL −7%`, vExit32sl7);
  summarize(`… sem SL`, vExit32nosl);
  summarize(`LONG cruzar >${ENTRY} → hold 24h / SL −5% (sem saída 32)`, v24sl5);
  summarize(`… hold 48h / SL −5%`, v48sl5);
  summarize(`sair >${EXIT} / SL −5% / 48h`, vExit32h48);

  if (vExit32sl5.length) {
    console.log('\nTrades (sair >32 SL−5%):');
    console.log(
      'Data'.padEnd(18) + 'Símbolo'.padEnd(16) + 'RSI'.padEnd(8) + 'P&L'.padEnd(10) + 'Path'.padEnd(10) + 'Máx+  Máx−'
    );
    for (const t of [...vExit32sl5].sort((a, b) => a.t - b.t)) {
      console.log(
        new Date(t.t).toISOString().slice(0, 16).padEnd(18) +
          t.sym.padEnd(16) +
          t.rsi.toFixed(1).padEnd(8) +
          ((t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2) + '%').padEnd(10) +
          t.path.padEnd(10) +
          ('+' + t.maxFav.toFixed(1)).padEnd(6) +
          ('+' + t.maxAdv.toFixed(1))
      );
    }
  }

  const fs = await import('fs');
  fs.writeFileSync(
    'scripts/out-rsi-vendido-25-32.json',
    JSON.stringify({ vExit32sl5, v24sl5, vExit32h48 }, null, 2)
  );
  console.log('\nJSON: scripts/out-rsi-vendido-25-32.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
