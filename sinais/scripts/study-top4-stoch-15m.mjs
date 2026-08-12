/**
 * Estudo: Scanner 2 Top 4 — Stochastic 15m (TV: K=20, Ksmooth=15, D=11)
 * Cron conceptual 5m; só actua em velas 15m fechadas.
 *
 * LONG: %K cruza %D para cima (enquanto no Top 4)
 * Saída: %K cruza %D para baixo | SL −5% | máx. hold 24h
 * SHORT opcional no cruzamento down (estudo separado na tabela)
 *
 * Uso: node scripts/study-top4-stoch-15m.mjs
 */

const API_BASE = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const BYBIT = 'https://api.bybit.nl';
const UNIVERSE = 'UNIVERSE_TOP30_PRICE_CHANGE_24H';
const FEE = 0.1;
const SIZE = 100;

const K_LEN = 20;
const K_SMOOTH = 15;
const D_SMOOTH = 11;
const SL_LONG = 5;
const SL_SHORT = 7;
const HOLD_H = 24;
const TOP_N = 4;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** TradingView Stochastic: %K Length / %K Smoothing / %D Smoothing */
function stochasticSeries(highs, lows, closes, kLen, kSmooth, dSmooth) {
  const n = closes.length;
  const rawK = new Array(n).fill(null);
  for (let i = kLen - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kLen + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const range = hh - ll;
    rawK[i] = range <= 0 ? 50 : ((closes[i] - ll) / range) * 100;
  }
  const k = new Array(n).fill(null);
  for (let i = kLen - 1 + kSmooth - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - kSmooth + 1; j <= i; j++) {
      if (rawK[j] == null) {
        ok = false;
        break;
      }
      sum += rawK[j];
    }
    if (ok) k[i] = sum / kSmooth;
  }
  const d = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < kLen - 1 + kSmooth - 1 + dSmooth - 1) continue;
    let sum = 0;
    let ok = true;
    for (let j = i - dSmooth + 1; j <= i; j++) {
      if (k[j] == null) {
        ok = false;
        break;
      }
      sum += k[j];
    }
    if (ok) d[i] = sum / dSmooth;
  }
  return { k, d };
}

async function loadTopHistory() {
  const data = await fetchJson(
    `${API_BASE}/api/universe-scans/${UNIVERSE}/history?top=${TOP_N}&limit=100`
  );
  return (data.runs || [])
    .map((r) => ({
      scannedAt: new Date(r.scannedAt).getTime(),
      top: (r.top || []).map((row, i) => ({
        rank: row.rank ?? i + 1,
        symbol: row.symbol,
      })),
    }))
    .sort((a, b) => a.scannedAt - b.scannedAt);
}

function inTopAt(runs, symbol, tMs) {
  let last = null;
  for (const r of runs) {
    if (r.scannedAt > tMs) break;
    last = r;
  }
  if (!last) return null;
  return last.top.find((x) => x.symbol === symbol && x.rank <= TOP_N) || null;
}

async function fetch15m(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const step = 15 * 60 * 1000;
  while (cursor < endMs) {
    const data = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=15&start=${cursor}&limit=1000`
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
    await new Promise((r) => setTimeout(r, 40));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

function simulateTrade(candles, entryIdx, direction, slPct) {
  const entry = candles[entryIdx].c;
  const entryTs = candles[entryIdx].t + 15 * 60 * 1000; // close of bar
  const endTs = entryTs + HOLD_H * 3600 * 1000;
  let exitPct = null;
  let path = 'TIME';
  let maxFav = 0;
  let maxAdv = 0;

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
    }
  }

  // mark at hold end or last available
  if (exitPct == null) {
    let close = entry;
    for (let i = entryIdx + 1; i < candles.length; i++) {
      if (candles[i].t > endTs) break;
      close = candles[i].c;
    }
    exitPct =
      direction === 'BUY'
        ? ((close - entry) / entry) * 100
        : ((entry - close) / entry) * 100;
  }

  return { pnl: exitPct - FEE, path, maxFav, maxAdv, entry, entryTs };
}

async function main() {
  console.log('═'.repeat(96));
  console.log('Estudo Top 4 — Stochastic 15m (K=20 / Ksmooth=15 / D=11) | wait for close');
  console.log(`LONG SL −${SL_LONG}% | SHORT SL +${SL_SHORT}% | hold máx ${HOLD_H}h | fee ${FEE}%`);
  console.log('═'.repeat(96));

  const runs = await loadTopHistory();
  if (!runs.length) {
    console.error('Sem histórico Top 4');
    process.exit(1);
  }
  const t0 = runs[0].scannedAt;
  const t1 = runs[runs.length - 1].scannedAt;
  const symbols = [...new Set(runs.flatMap((r) => r.top.map((x) => x.symbol)))];
  console.log(
    `Scans: ${runs.length} | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)} | símbolos ${symbols.length}`
  );

  const warmMs = (K_LEN + K_SMOOTH + D_SMOOTH + 30) * 15 * 60 * 1000;
  const longTrades = [];
  const shortTrades = [];
  const flipTrades = []; // long until cross down

  let si = 0;
  for (const sym of symbols) {
    si++;
    process.stdout.write(`\r${si}/${symbols.length} ${sym.padEnd(14)}`);
    let candles;
    try {
      candles = await fetch15m(sym, t0 - warmMs, t1 + HOLD_H * 3600 * 1000);
    } catch (e) {
      console.log(`\n skip ${sym}: ${e.message}`);
      continue;
    }
    // só fechadas
    const closed = candles.filter((c) => c.t + 15 * 60 * 1000 <= Date.now());
    if (closed.length < K_LEN + K_SMOOTH + D_SMOOTH + 10) continue;

    const highs = closed.map((c) => c.h);
    const lows = closed.map((c) => c.l);
    const closes = closed.map((c) => c.c);
    const { k, d } = stochasticSeries(highs, lows, closes, K_LEN, K_SMOOTH, D_SMOOTH);

    for (let i = 1; i < closed.length; i++) {
      const k0 = k[i - 1];
      const k1 = k[i];
      const d0 = d[i - 1];
      const d1 = d[i];
      if (k0 == null || k1 == null || d0 == null || d1 == null) continue;

      const barClose = closed[i].t + 15 * 60 * 1000 - 1;
      const mem = inTopAt(runs, sym, barClose);
      if (!mem) continue;

      const crossUp = k0 <= d0 && k1 > d1;
      const crossDown = k0 >= d0 && k1 < d1;

      if (crossUp) {
        const r = simulateTrade(closed, i, 'BUY', SL_LONG);
        longTrades.push({
          sym,
          rank: mem.rank,
          t: new Date(r.entryTs).toISOString(),
          k: +k1.toFixed(1),
          d: +d1.toFixed(1),
          ...r,
        });

        // flip exit: walk until cross down or SL/time
        let exitPnl = null;
        let exitPath = 'TIME';
        let maxFav = 0;
        let maxAdv = 0;
        const entry = closed[i].c;
        const endTs = r.entryTs + HOLD_H * 3600 * 1000;
        for (let j = i + 1; j < closed.length; j++) {
          const bar = closed[j];
          if (bar.t > endTs) break;
          const fav = ((bar.h - entry) / entry) * 100;
          const adv = ((entry - bar.l) / entry) * 100;
          if (fav > maxFav) maxFav = fav;
          if (adv > maxAdv) maxAdv = adv;
          if (bar.l <= entry * (1 - SL_LONG / 100)) {
            exitPnl = -SL_LONG - FEE;
            exitPath = 'SL';
            break;
          }
          const kj = k[j];
          const dj = d[j];
          const kp = k[j - 1];
          const dp = d[j - 1];
          if (kj != null && dj != null && kp != null && dp != null && kp >= dp && kj < dj) {
            exitPnl = ((bar.c - entry) / entry) * 100 - FEE;
            exitPath = 'CROSS_DOWN';
            break;
          }
        }
        if (exitPnl == null) {
          let close = entry;
          for (let j = i + 1; j < closed.length; j++) {
            if (closed[j].t > endTs) break;
            close = closed[j].c;
          }
          exitPnl = ((close - entry) / entry) * 100 - FEE;
        }
        flipTrades.push({
          sym,
          rank: mem.rank,
          t: new Date(r.entryTs).toISOString(),
          pnl: exitPnl,
          path: exitPath,
          maxFav,
          maxAdv,
        });
      }

      if (crossDown) {
        const r = simulateTrade(closed, i, 'SELL', SL_SHORT);
        shortTrades.push({
          sym,
          rank: mem.rank,
          t: new Date(r.entryTs).toISOString(),
          k: +k1.toFixed(1),
          d: +d1.toFixed(1),
          ...r,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 35));
  }
  console.log('\n');

  function summarize(label, trades) {
    if (!trades.length) {
      console.log(`\n${label}: 0 trades`);
      return null;
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
      sum,
      usdt: (sum * SIZE) / 100,
      wr: (100 * wins) / trades.length,
      avgFav,
      avgAdv,
      byPath,
    };
    console.log('\n' + '─'.repeat(96));
    console.log(label);
    console.log(
      `Trades ${s.n} | média ${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(3)}% | soma ${(s.sum >= 0 ? '+' : '') + s.sum.toFixed(1)}% | USDT ${(s.usdt >= 0 ? '+' : '') + s.usdt.toFixed(0)} | WR ${s.wr.toFixed(1)}%`
    );
    console.log(
      `Máx+ médio +${s.avgFav.toFixed(2)}% | Máx− médio +${s.avgAdv.toFixed(2)}% | paths`,
      s.byPath
    );
    return s;
  }

  longTrades.sort((a, b) => a.t.localeCompare(b.t));
  shortTrades.sort((a, b) => a.t.localeCompare(b.t));
  flipTrades.sort((a, b) => a.t.localeCompare(b.t));

  console.log('\n══ LONG: K×D up → hold 24h / SL −5% ══');
  console.log(
    'Data UTC'.padEnd(18) +
      'Símbolo'.padEnd(14) +
      'Rk'.padEnd(4) +
      'K/D'.padEnd(12) +
      'P&L%'.padEnd(10) +
      'Path'.padEnd(8) +
      'Máx+'.padEnd(8) +
      'Máx−'
  );
  for (const t of longTrades) {
    console.log(
      t.t.slice(0, 16).padEnd(18) +
        t.sym.padEnd(14) +
        String(t.rank).padEnd(4) +
        `${t.k}/${t.d}`.padEnd(12) +
        ((t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2) + '%').padEnd(10) +
        t.path.padEnd(8) +
        ('+' + t.maxFav.toFixed(1)).padEnd(8) +
        ('+' + t.maxAdv.toFixed(1))
    );
  }
  const sLong = summarize('LONG K×D up (SL5% / 24h)', longTrades);

  console.log('\n══ LONG flip: K×D up → sai no K×D down (ou SL/24h) ══');
  for (const t of flipTrades.slice(0, 40)) {
    console.log(
      t.t.slice(0, 16).padEnd(18) +
        t.sym.padEnd(14) +
        String(t.rank).padEnd(4) +
        ((t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2) + '%').padEnd(10) +
        t.path.padEnd(12) +
        ('+' + t.maxFav.toFixed(1)).padEnd(8) +
        ('+' + t.maxAdv.toFixed(1))
    );
  }
  if (flipTrades.length > 40) console.log(`... +${flipTrades.length - 40} trades`);
  const sFlip = summarize('LONG até cross down', flipTrades);

  console.log('\n══ SHORT: K×D down → hold 24h / SL +7% ══');
  for (const t of shortTrades.slice(0, 30)) {
    console.log(
      t.t.slice(0, 16).padEnd(18) +
        t.sym.padEnd(14) +
        String(t.rank).padEnd(4) +
        `${t.k}/${t.d}`.padEnd(12) +
        ((t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2) + '%').padEnd(10) +
        t.path.padEnd(8) +
        ('+' + t.maxFav.toFixed(1)).padEnd(8) +
        ('+' + t.maxAdv.toFixed(1))
    );
  }
  if (shortTrades.length > 30) console.log(`... +${shortTrades.length - 30} trades`);
  const sShort = summarize('SHORT K×D down (SL7% / 24h)', shortTrades);

  // by rank for long flip (main candidate)
  console.log('\nPor rank (LONG até cross down):');
  for (const rk of [1, 2, 3, 4]) {
    const g = flipTrades.filter((t) => t.rank === rk);
    if (!g.length) continue;
    const s = g.reduce((a, b) => a + b.pnl, 0);
    console.log(
      `  #${rk} n=${g.length} avg=${(s / g.length >= 0 ? '+' : '') + (s / g.length).toFixed(2)}% USDT=${(s >= 0 ? '+' : '') + s.toFixed(0)}`
    );
  }

  const fs = await import('fs');
  fs.writeFileSync(
    'scripts/out-top4-stoch-15m.json',
    JSON.stringify(
      {
        meta: {
          kLen: K_LEN,
          kSmooth: K_SMOOTH,
          dSmooth: D_SMOOTH,
          tf: '15m',
          t0,
          t1,
          topN: TOP_N,
        },
        long: sLong,
        flip: sFlip,
        short: sShort,
        longTrades,
        flipTrades,
        shortTrades,
      },
      null,
      2
    )
  );
  console.log('\nJSON: scripts/out-top4-stoch-15m.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
