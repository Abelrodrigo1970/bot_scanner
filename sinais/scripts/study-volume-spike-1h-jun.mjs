/**
 * Estudo: Volume Spike 1h
 * Entrada BUY: preço sobe ≥ +5% (fecho vs fecho ant.) E volume ≥ 12× média das 10 velas anteriores
 * Período: 2026-06-01 → agora
 *
 *   node scripts/study-volume-spike-1h-jun.mjs
 *   node scripts/study-volume-spike-1h-jun.mjs --candidates=80 --minQuote=1000000
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const H1 = 60 * 60 * 1000;
const PRICE_PCT = 5;
const VOL_MULT = 12;
const VOL_LOOKBACK = 10;
const WARM_BARS = 20;
const CONCURRENCY = 8;
const MIN_QUOTE_DEFAULT = 500_000;
const CANDIDATES_DEFAULT = 100;

/** Saídas a testar (SL%, TP%, hold horas). */
const EXITS = [
  { key: 'sl5_tp10_24h', sl: 5, tp: 10, holdH: 24 },
  { key: 'sl8_tp15_24h', sl: 8, tp: 15, holdH: 24 },
  { key: 'sl5_tp10_12h', sl: 5, tp: 10, holdH: 12 },
  { key: 'sl10_tp20_48h', sl: 10, tp: 20, holdH: 48 },
  { key: 'hold_4h', sl: null, tp: null, holdH: 4 },
  { key: 'hold_24h', sl: null, tp: null, holdH: 24 },
];

const DIR = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-06-01T00:00:00.000Z');
const t1 = Date.now();
const candidates = Math.max(
  20,
  Number(process.argv.find((a) => a.startsWith('--candidates='))?.split('=')[1] || CANDIDATES_DEFAULT)
);
const minQuote = Number(
  process.argv.find((a) => a.startsWith('--minQuote='))?.split('=')[1] || MIN_QUOTE_DEFAULT
);
const CACHE = path.join(DIR, `cache-volume-spike-1h-jun-c${candidates}.json`);
const stamp = `${new Date(t0).toISOString().slice(0, 10)}_to_${new Date(t1).toISOString().slice(0, 10)}`;
const OUT = path.join(DIR, `out-volume-spike-1h-jun-${stamp}.json`);

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

async function fetchJson(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
}

async function candidateSymbols() {
  const data = await fetchJson(`${BYBIT}/v5/market/tickers?category=linear`);
  const list = data.result?.list || [];
  return list
    .filter((t) => t.symbol?.endsWith('USDT') && !t.symbol.includes('-') && +t.turnover24h >= minQuote)
    .sort((a, b) => +b.turnover24h - +a.turnover24h)
    .slice(0, candidates)
    .map((t) => t.symbol);
}

async function fetchH1(symbol) {
  const start = t0 - WARM_BARS * H1;
  const out = [];
  let cursor = start;
  let guard = 0;
  while (cursor < t1 && guard++ < 250) {
    const j = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=60&start=${cursor}&limit=1000`
    );
    const list = (j?.result?.list || [])
      .map((r) => ({
        t: Number(r[0]),
        o: +r[1],
        h: +r[2],
        l: +r[3],
        c: +r[4],
        v: +r[5],
      }))
      .sort((a, b) => a.t - b.t);
    if (!list.length) break;
    for (const b of list) if (b.t >= start && b.t <= t1) out.push(b);
    const last = list[list.length - 1].t;
    if (last + H1 <= cursor) break;
    cursor = last + H1;
    if (list.length < 1000) break;
    await new Promise((r) => setTimeout(r, 12));
  }
  return [...new Map(out.map((b) => [b.t, b])).values()].sort((a, b) => a.t - b.t);
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

/** Sinais na última vela FECHADA: i = índice do sinal. */
function findSignals(symbol, bars) {
  const signals = [];
  // última barra pode estar em formação — só usamos fechadas até length-2 se last ≈ now
  const lastClosed = bars.length - 1;
  for (let i = VOL_LOOKBACK + 1; i <= lastClosed; i++) {
    const bar = bars[i];
    if (bar.t < t0 || bar.t > t1) continue;
    const prev = bars[i - 1];
    if (!(prev.c > 0) || !(bar.c > 0) || !(bar.v > 0)) continue;

    const pricePct = ((bar.c - prev.c) / prev.c) * 100;
    if (pricePct < PRICE_PCT) continue;

    let sumV = 0;
    for (let j = i - VOL_LOOKBACK; j < i; j++) sumV += bars[j].v;
    const avgV = sumV / VOL_LOOKBACK;
    if (!(avgV > 0)) continue;
    const volRatio = bar.v / avgV;
    if (volRatio < VOL_MULT) continue;

    signals.push({
      symbol,
      entryTs: bar.t,
      entryAt: iso(bar.t),
      entry: bar.c,
      pricePct: +pricePct.toFixed(2),
      volRatio: +volRatio.toFixed(2),
      volume: bar.v,
      avgVol10: +avgV.toFixed(2),
      idx: i,
    });
  }
  return signals;
}

function simulateTrade(bars, sig, exitCfg) {
  const entry = sig.entry;
  const entryIdx = sig.idx;
  const slPx = exitCfg.sl != null ? entry * (1 - exitCfg.sl / 100) : null;
  const tpPx = exitCfg.tp != null ? entry * (1 + exitCfg.tp / 100) : null;
  const maxIdx = Math.min(bars.length - 1, entryIdx + Math.max(1, exitCfg.holdH));

  for (let i = entryIdx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    if (slPx != null && b.l <= slPx) {
      return {
        exitTs: b.t,
        exitAt: iso(b.t),
        exit: slPx,
        path: 'SL',
        pnlPct: -exitCfg.sl - FEE,
        barsHeld: i - entryIdx,
      };
    }
    if (tpPx != null && b.h >= tpPx) {
      return {
        exitTs: b.t,
        exitAt: iso(b.t),
        exit: tpPx,
        path: 'TP',
        pnlPct: exitCfg.tp - FEE,
        barsHeld: i - entryIdx,
      };
    }
  }
  const last = bars[maxIdx];
  const pnlPct = ((last.c - entry) / entry) * 100 - FEE;
  return {
    exitTs: last.t,
    exitAt: iso(last.t),
    exit: last.c,
    path: 'TIME',
    pnlPct: +pnlPct.toFixed(4),
    barsHeld: maxIdx - entryIdx,
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) {
    return { n: 0, wins: 0, wr: 0, usdt: 0, avg: 0, pf: 0, maxDd: 0 };
  }
  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const grossWin = trades.filter((t) => t.usdt > 0).reduce((a, t) => a + t.usdt, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.usdt < 0).reduce((a, t) => a + t.usdt, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  const sorted = [...trades].sort((a, b) => a.exitTs - b.exitTs || a.entryTs - b.entryTs);
  for (const t of sorted) {
    equity += t.usdt;
    if (equity > peak) peak = equity;
    maxDd = Math.max(maxDd, peak - equity);
  }
  const paths = {};
  for (const t of trades) paths[t.path] = (paths[t.path] || 0) + 1;
  const monthly = {};
  for (const t of trades) {
    const m = t.exitAt.slice(0, 7);
    if (!monthly[m]) monthly[m] = { n: 0, wins: 0, usdt: 0 };
    monthly[m].n++;
    monthly[m].usdt += t.usdt;
    if (t.usdt > 0) monthly[m].wins++;
  }
  const bySym = new Map();
  for (const t of trades) {
    const cur = bySym.get(t.symbol) || { n: 0, wins: 0, usdt: 0 };
    cur.n++;
    cur.usdt += t.usdt;
    if (t.usdt > 0) cur.wins++;
    bySym.set(t.symbol, cur);
  }
  const ranking = [...bySym.entries()]
    .map(([symbol, s]) => ({
      symbol,
      n: s.n,
      wr: +((100 * s.wins) / s.n).toFixed(1),
      usdt: +s.usdt.toFixed(2),
    }))
    .sort((a, b) => b.usdt - a.usdt);

  return {
    n,
    wins,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    maxDd: +maxDd.toFixed(2),
    paths,
    monthly: Object.fromEntries(
      Object.entries(monthly)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, s]) => [
          m,
          { n: s.n, wr: +((100 * s.wins) / s.n).toFixed(1), usdt: +s.usdt.toFixed(2) },
        ])
    ),
    top15: ranking.slice(0, 15),
    worst10: [...ranking].sort((a, b) => a.usdt - b.usdt).slice(0, 10),
  };
}

async function main() {
  console.log('═'.repeat(80));
  console.log(
    `Volume Spike 1h · preço ≥+${PRICE_PCT}% · vol ≥${VOL_MULT}× média ${VOL_LOOKBACK} velas`
  );
  console.log(
    `${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)} · top ${candidates} · minQuote ${minQuote}`
  );
  console.log('═'.repeat(80));

  let symbols = [];
  let klines = {};
  if (existsSync(CACHE)) {
    try {
      const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
      symbols = cached.symbols || [];
      klines = cached.klines || {};
      console.log(`Cache: ${symbols.length} símbolos / ${Object.keys(klines).length} klines`);
    } catch {
      /* ignore */
    }
  }
  if (!symbols.length) {
    symbols = await candidateSymbols();
    console.log(`Candidatos: ${symbols.length}`);
  }

  const need = symbols.filter((s) => {
    const bars = klines[s];
    const last = bars?.[bars.length - 1]?.t || 0;
    return !bars || bars.length < 100 || last < t1 - 3 * H1;
  });
  if (need.length) {
    console.log(`A buscar 1h: ${need.length}…`);
    let done = 0;
    await mapPool(need, CONCURRENCY, async (sym) => {
      try {
        klines[sym] = await fetchH1(sym);
      } catch (e) {
        console.warn(`  fail ${sym}: ${e.message || e}`);
        klines[sym] = klines[sym] || [];
      }
      done++;
      if (done % 10 === 0 || done === need.length) console.log(`  ${done}/${need.length}`);
    });
    writeFileSync(
      CACHE,
      JSON.stringify({
        meta: { from: new Date(t0).toISOString(), to: new Date(t1).toISOString(), candidates, minQuote },
        symbols,
        klines,
      })
    );
    console.log('Cache gravado', CACHE);
  }

  const allSignals = [];
  for (const sym of symbols) {
    const bars = klines[sym] || [];
    if (bars.length < VOL_LOOKBACK + 5) continue;
    allSignals.push(...findSignals(sym, bars));
  }
  allSignals.sort((a, b) => a.entryTs - b.entryTs);
  console.log(`\nSinais brutos (sem overlap): ${allSignals.length}`);

  const byExit = {};
  for (const exitCfg of EXITS) {
    const trades = [];
    const busy = new Map(); // symbol -> busyUntil
    for (const sig of allSignals) {
      const until = busy.get(sig.symbol) || 0;
      if (sig.entryTs < until) continue;
      const bars = klines[sig.symbol];
      const walk = simulateTrade(bars, sig, exitCfg);
      const usdt = +((walk.pnlPct * SIZE) / 100).toFixed(2);
      trades.push({
        symbol: sig.symbol,
        entryTs: sig.entryTs,
        entryAt: sig.entryAt,
        exitTs: walk.exitTs,
        exitAt: walk.exitAt,
        entry: sig.entry,
        pricePct: sig.pricePct,
        volRatio: sig.volRatio,
        path: walk.path,
        barsHeld: walk.barsHeld,
        pnlPct: +walk.pnlPct.toFixed(2),
        usdt,
      });
      busy.set(sig.symbol, walk.exitTs);
    }
    const summary = summarize(trades);
    byExit[exitCfg.key] = {
      exit: exitCfg,
      summary,
      sample: trades.slice(0, 3).concat(trades.slice(-2)),
    };
    console.log(
      `\n── ${exitCfg.key} ── n=${summary.n} WR=${summary.wr}% USDT=${summary.usdt >= 0 ? '+' : ''}${summary.usdt} avg=${summary.avg} PF=${summary.pf} maxDD=${summary.maxDd}`
    );
    console.log('  paths', summary.paths);
    if (summary.monthly) {
      for (const [m, s] of Object.entries(summary.monthly)) {
        console.log(`  ${m}  n=${s.n} WR=${s.wr}%  ${(s.usdt >= 0 ? '+' : '') + s.usdt}`);
      }
    }
  }

  // Forward returns nos sinais (sem overlap por símbolo)
  const fwd = { h1: [], h4: [], h12: [], h24: [] };
  const busyFwd = new Map();
  for (const sig of allSignals) {
    const until = busyFwd.get(sig.symbol) || 0;
    if (sig.entryTs < until) continue;
    const bars = klines[sig.symbol];
    const i = sig.idx;
    const ret = (hours) => {
      const j = Math.min(bars.length - 1, i + hours);
      return +((((bars[j].c - sig.entry) / sig.entry) * 100).toFixed(3));
    };
    fwd.h1.push(ret(1));
    fwd.h4.push(ret(4));
    fwd.h12.push(ret(12));
    fwd.h24.push(ret(24));
    busyFwd.set(sig.symbol, bars[Math.min(bars.length - 1, i + 24)]?.t || sig.entryTs);
  }
  function avg(arr) {
    return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : 0;
  }
  function wrPos(arr) {
    return arr.length ? +((100 * arr.filter((x) => x > 0).length) / arr.length).toFixed(1) : 0;
  }
  const forward = {
    n: fwd.h1.length,
    h1: { avg: avg(fwd.h1), wr: wrPos(fwd.h1) },
    h4: { avg: avg(fwd.h4), wr: wrPos(fwd.h4) },
    h12: { avg: avg(fwd.h12), wr: wrPos(fwd.h12) },
    h24: { avg: avg(fwd.h24), wr: wrPos(fwd.h24) },
  };
  console.log('\n── Forward returns (1 posição/símbolo) ──');
  console.log(forward);

  const bestKey = Object.entries(byExit).sort((a, b) => b[1].summary.usdt - a[1].summary.usdt)[0]?.[0];
  const best = byExit[bestKey];

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        meta: {
          timeframe: '1h',
          from: new Date(t0).toISOString(),
          to: new Date(t1).toISOString(),
          pricePctMin: PRICE_PCT,
          volMult: VOL_MULT,
          volLookback: VOL_LOOKBACK,
          candidates,
          minQuote,
          feePct: FEE,
          sizeUsdt: SIZE,
          note: 'BUY se (close/prevClose-1)≥5% e volume ≥12× média das 10 velas anteriores. 1 posição/símbolo.',
        },
        signalCountRaw: allSignals.length,
        forward,
        bestExit: bestKey,
        byExit: Object.fromEntries(
          Object.entries(byExit).map(([k, v]) => [k, { exit: v.exit, summary: v.summary }])
        ),
        bestDetail: best
          ? {
              exit: best.exit,
              summary: best.summary,
              top15: best.summary.top15,
              worst10: best.summary.worst10,
            }
          : null,
      },
      null,
      2
    )
  );
  console.log('\nMelhor saída:', bestKey, best?.summary);
  console.log('JSON', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
