/**
 * Grelha rsi_vendido: LONG recuperação (cruzar acima de ENTRY após ter estado abaixo)
 * e LONG mergulho (cruzar abaixo de ENTRY).
 *
 * Uso: node scripts/study-rsi-vendido-grid.mjs
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

const ENTRIES = [18, 20, 22, 25, 28, 30, 32];
const EXITS = [28, 32, 35, 40, 45, 50];

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

function simulate(candles, entryIdx, rsi, exitLevel, holdH, slPct) {
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
    if (exitLevel != null) {
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (r0 != null && r1 != null && r0 <= exitLevel && r1 > exitLevel) {
        exitPct = ((bar.c - entry) / entry) * 100;
        path = 'RSI_UP';
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
    exitPct = ((close - entry) / entry) * 100;
  }
  return { pnl: exitPct - FEE, path, maxFav, maxAdv };
}

function stats(trades) {
  if (!trades.length) return { n: 0, avg: 0, usdt: 0, wr: 0, avgFav: 0, avgAdv: 0, sl: 0, rsiUp: 0 };
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const trimmed = trades.filter((t) => Math.abs(t.pnl) < 15);
  const tSum = trimmed.reduce((a, b) => a + b.pnl, 0);
  return {
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins) / trades.length,
    avgFav: trades.reduce((a, b) => a + b.maxFav, 0) / trades.length,
    avgAdv: trades.reduce((a, b) => a + b.maxAdv, 0) / trades.length,
    sl: trades.filter((t) => t.path === 'SL').length,
    rsiUp: trades.filter((t) => t.path === 'RSI_UP').length,
    nTrim: trimmed.length,
    avgTrim: trimmed.length ? tSum / trimmed.length : 0,
    usdtTrim: (tSum * SIZE) / 100,
  };
}

function key(mode, entry, exit) {
  return `${mode}|${entry}|${exit ?? '24h'}`;
}

async function main() {
  const now = Date.now();
  const t0 = now - LOOKBACK_MS;
  const t1 = now;
  console.log('═'.repeat(96));
  console.log(
    `Grelha RSI 4h | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)} | SL −${SL}% hold ${HOLD_H}h fee ${FEE}%`
  );
  console.log('═'.repeat(96));

  const combos = [];
  for (const e of ENTRIES) {
    for (const x of EXITS) {
      if (x <= e) continue;
      combos.push({ mode: 'up', entry: e, exit: x });
    }
    combos.push({ mode: 'up', entry: e, exit: null });
  }
  for (const e of [25, 28, 32]) {
    for (const x of [32, 40, 50]) {
      if (x <= e && e !== 32) continue;
      combos.push({ mode: 'down', entry: e, exit: x === e ? 32 : x });
    }
    combos.push({ mode: 'down', entry: e, exit: null });
  }

  const buckets = {};
  for (const c of combos) buckets[key(c.mode, c.entry, c.exit)] = [];

  const symbols = await topLinearSymbols();
  console.log(`Símbolos ${symbols.length} | combos ${combos.length}`);

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

    const wasBelow = {};
    for (const e of ENTRIES) wasBelow[e] = false;

    for (let i = 1; i < closed.length; i++) {
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (r0 == null || r1 == null) continue;
      const inWindow = closed[i].t >= t0 && closed[i].t <= t1;

      for (const e of ENTRIES) {
        if (r1 < e) wasBelow[e] = true;
        if (inWindow && wasBelow[e] && r0 < e && r1 >= e) {
          for (const c of combos) {
            if (c.mode !== 'up' || c.entry !== e) continue;
            buckets[key('up', e, c.exit)].push(simulate(closed, i, rsi, c.exit, HOLD_H, SL));
          }
          wasBelow[e] = false;
        }
      }

      if (!inWindow) continue;
      for (const e of [25, 28, 32]) {
        if (r0 >= e && r1 < e) {
          for (const c of combos) {
            if (c.mode !== 'down' || c.entry !== e) continue;
            buckets[key('down', e, c.exit)].push(simulate(closed, i, rsi, c.exit, HOLD_H, SL));
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log('\n');

  const rows = combos.map((c) => {
    const k = key(c.mode, c.entry, c.exit);
    const s = stats(buckets[k]);
    return {
      mode: c.mode === 'up' ? 'recuperação >E' : 'mergulho <E',
      entry: c.entry,
      exit: c.exit == null ? '24h' : String(c.exit),
      ...s,
    };
  });

  rows.sort((a, b) => b.avg - a.avg);

  console.log(
    'Modo'.padEnd(16) +
      'E'.padEnd(5) +
      'S'.padEnd(6) +
      'N'.padEnd(6) +
      'Avg%'.padEnd(9) +
      'USDT'.padEnd(8) +
      'WR'.padEnd(8) +
      'sem|15|%'.padEnd(11) +
      'SL'
  );
  for (const r of rows) {
    if (r.n < 8) continue;
    console.log(
      r.mode.padEnd(16) +
        String(r.entry).padEnd(5) +
        r.exit.padEnd(6) +
        String(r.n).padEnd(6) +
        ((r.avg >= 0 ? '+' : '') + r.avg.toFixed(2)).padEnd(9) +
        ((r.usdt >= 0 ? '+' : '') + r.usdt.toFixed(0)).padEnd(8) +
        (r.wr.toFixed(0) + '%').padEnd(8) +
        ((r.avgTrim >= 0 ? '+' : '') + r.avgTrim.toFixed(2)).padEnd(11) +
        String(r.sl)
    );
  }

  const fs = await import('fs');
  fs.writeFileSync('scripts/out-rsi-vendido-grid.json', JSON.stringify({ rows }, null, 2));
  console.log('\nJSON: scripts/out-rsi-vendido-grid.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
