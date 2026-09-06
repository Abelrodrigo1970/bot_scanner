/**
 * rsi_vendido LONG 15m — últimos 60 dias
 * Universo: Scanner 6 (fecho > SMA80 4h), top 40 por |% vs MA|
 * Entrada: RSI(14) 15m cruza abaixo de 28
 * SL −5% | TP1 +10% (30%) | TP2 +48% (30%)
 * Resto: RSI cruza para baixo da SMA(14) do RSI com RSI > 65
 *
 * Uso: node scripts/study-rsi-vendido-15m-60d.mjs
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const BYBIT = 'https://api.bybit.nl';
const FEE = 0.1;
const SIZE = 100;
const RSI_P = 14;
const RSI_MA_P = 14;
const ENTRY = 28;
const TRAIL_MIN = 65;
const SL = 5;
const TP1 = 10;
const TP1_POS = 30;
const TP2 = 48;
const TP2_POS = 30;
const TOP_N = 40;
const CANDIDATE_LIMIT = 200;
const MIN_TURNOVER = 500_000;
const DAYS = 60;
const SMA80 = 80;
const LOOKBACK_MS = DAYS * 24 * 3600 * 1000;
const H4 = 4 * 3600 * 1000;
const M15 = 15 * 60 * 1000;

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out-rsi-vendido-15m-60d.json');

async function fetchJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 3) throw e;
      await sleep(200 * (i + 1));
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] == null || !Number.isFinite(values[j])) {
        ok = false;
        break;
      }
      sum += values[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

function smaAt(closes, i, period) {
  if (i + 1 < period) return null;
  let s = 0;
  for (let j = i - period + 1; j <= i; j++) s += closes[j];
  return s / period;
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

async function fetchKlines(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const step =
    interval === '240' ? H4 : interval === '15' ? M15 : Number(interval) * 60 * 1000;
  while (cursor < endMs) {
    const data = await fetchJson(
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&start=${cursor}&limit=1000`
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
    await sleep(20);
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

/**
 * PnL ponderado com TPs parciais.
 * Conservador: no mesmo bar, SL antes de TP.
 */
function simulateTrade(c15, entryIdx, rsi, rsiMa) {
  const entry = c15[entryIdx].c;
  const entryT = c15[entryIdx].t;
  const slPx = entry * (1 - SL / 100);
  const tp1Px = entry * (1 + TP1 / 100);
  const tp2Px = entry * (1 + TP2 / 100);

  let rem = 100;
  let pnlWeighted = 0;
  let tp1Hit = false;
  let tp2Hit = false;
  let path = 'OPEN';
  let maxFav = 0;
  let maxAdv = 0;
  let exitT = null;
  let bars = 0;

  for (let i = entryIdx + 1; i < c15.length; i++) {
    const bar = c15[i];
    bars++;
    const fav = ((bar.h - entry) / entry) * 100;
    const adv = ((entry - bar.l) / entry) * 100;
    if (fav > maxFav) maxFav = fav;
    if (adv > maxAdv) maxAdv = adv;

    if (bar.l <= slPx) {
      pnlWeighted += (rem / 100) * -SL;
      rem = 0;
      path = tp1Hit || tp2Hit ? 'SL_AFTER_TP' : 'SL';
      exitT = bar.t;
      break;
    }

    if (!tp1Hit && bar.h >= tp1Px) {
      pnlWeighted += (TP1_POS / 100) * TP1;
      rem -= TP1_POS;
      tp1Hit = true;
    }
    if (!tp2Hit && rem > 0 && bar.h >= tp2Px) {
      const take = Math.min(TP2_POS, rem);
      pnlWeighted += (take / 100) * TP2;
      rem -= take;
      tp2Hit = true;
      if (rem <= 0) {
        path = 'TP_FULL';
        exitT = bar.t;
        break;
      }
    }

    if (rem > 0) {
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      const m0 = rsiMa[i - 1];
      const m1 = rsiMa[i];
      if (
        r0 != null &&
        r1 != null &&
        m0 != null &&
        m1 != null &&
        r1 > TRAIL_MIN &&
        r0 >= m0 &&
        r1 < m1
      ) {
        const exitPct = ((bar.c - entry) / entry) * 100;
        pnlWeighted += (rem / 100) * exitPct;
        rem = 0;
        path = tp1Hit || tp2Hit ? 'RSI_MA_AFTER_TP' : 'RSI_MA';
        exitT = bar.t;
        break;
      }
    }
  }

  if (rem > 0) {
    const last = c15[c15.length - 1];
    const exitPct = ((last.c - entry) / entry) * 100;
    pnlWeighted += (rem / 100) * exitPct;
    path = 'EOD';
    exitT = last.t;
  }

  return {
    pnl: pnlWeighted - FEE,
    path,
    maxFav,
    maxAdv,
    tp1Hit,
    tp2Hit,
    bars,
    entryT,
    exitT,
    entry,
  };
}

function summarize(trades) {
  if (!trades.length) {
    return { n: 0, wr: 0, avg: 0, usdt: 0, pf: 0, byPath: {}, avgBars: 0, avgFav: 0, avgAdv: 0 };
  }
  const sum = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const byPath = {};
  for (const t of trades) byPath[t.path] = (byPath[t.path] || 0) + 1;
  return {
    n: trades.length,
    wr: (100 * wins.length) / trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    pf: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    byPath,
    avgBars: trades.reduce((a, t) => a + t.bars, 0) / trades.length,
    avgFav: trades.reduce((a, t) => a + t.maxFav, 0) / trades.length,
    avgAdv: trades.reduce((a, t) => a + t.maxAdv, 0) / trades.length,
    tp1Rate: (100 * trades.filter((t) => t.tp1Hit).length) / trades.length,
    tp2Rate: (100 * trades.filter((t) => t.tp2Hit).length) / trades.length,
  };
}

async function main() {
  const now = Date.now();
  const t0 = now - LOOKBACK_MS;
  const t1 = now;
  console.log('═'.repeat(96));
  console.log(
    `rsi_vendido 15m · Scanner 6 top ${TOP_N} · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );
  console.log(
    `RSI<${ENTRY} | SL −${SL}% | TP1 +${TP1}% ${TP1_POS}% | TP2 +${TP2}% ${TP2_POS}% | resto RSI×SMA${RSI_MA_P} down RSI>${TRAIL_MIN} | fee ${FEE}% | size $${SIZE}`
  );
  console.log('═'.repeat(96));

  const symbols = await topLinearSymbols();
  console.log(`Candidatos volume: ${symbols.length}`);

  /** @type {Map<string, {t:number,o:number,h:number,l:number,c:number}[]>} */
  const h4BySym = new Map();
  /** @type {Map<string, {t:number,o:number,h:number,l:number,c:number}[]>} */
  const m15BySym = new Map();

  let si = 0;
  for (const sym of symbols) {
    si++;
    process.stdout.write(`\rFetch ${si}/${symbols.length} ${sym.padEnd(16)}`);
    try {
      const h4 = await fetchKlines(sym, '240', t0 - (SMA80 + 5) * H4, t1);
      if (h4.length < SMA80 + 5) continue;
      const m15 = await fetchKlines(sym, '15', t0 - 40 * M15, t1 + 2 * 24 * 3600 * 1000);
      if (m15.length < RSI_P + RSI_MA_P + 20) continue;
      h4BySym.set(sym, h4);
      m15BySym.set(sym, m15);
    } catch {
      /* skip */
    }
  }
  console.log(`\nSímbolos com dados: ${m15BySym.size}`);

  // Snapshot Scanner 6 a cada fecho 4h: top N por |pctFromMa|
  /** @type {Map<number, Set<string>>} */
  const universeAt = new Map();
  const h4Times = new Set();
  for (const h4 of h4BySym.values()) {
    for (const b of h4) {
      if (b.t >= t0 - H4 && b.t <= t1) h4Times.add(b.t);
    }
  }
  const sortedH4 = [...h4Times].sort((a, b) => a - b);
  console.log(`Barras 4h no período: ${sortedH4.length}`);

  for (const ts of sortedH4) {
    const rows = [];
    for (const [sym, h4] of h4BySym) {
      const i = h4.findIndex((c) => c.t === ts);
      if (i < 0) continue;
      const closes = h4.map((c) => c.c);
      const ma = smaAt(closes, i, SMA80);
      if (ma == null || !(ma > 0)) continue;
      const close = h4[i].c;
      if (close <= ma) continue;
      const pctFromMa = ((close - ma) / ma) * 100;
      rows.push({ sym, pctFromMa });
    }
    rows.sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));
    universeAt.set(ts, new Set(rows.slice(0, TOP_N).map((r) => r.sym)));
  }

  function inUniverse(sym, barT) {
    // última vela 4h fechada antes/igual ao fecho da 15m
    const closed4hOpen = Math.floor(barT / H4) * H4;
    // a vela 4h com open=closed4hOpen ainda pode estar a formar; usar a anterior
    let ts = closed4hOpen - H4;
    // se barT está no fim da vela 4h (próximo open), a vela closed4hOpen já fechou
    if (barT + M15 >= closed4hOpen + H4) ts = closed4hOpen;
    // procurar snapshot exacto ou o mais recente ≤ ts
    if (universeAt.has(ts)) return universeAt.get(ts).has(sym);
    let best = null;
    for (const k of universeAt.keys()) {
      if (k <= ts && (best == null || k > best)) best = k;
    }
    if (best == null) return false;
    return universeAt.get(best).has(sym);
  }

  const trades = [];
  const openUntil = new Map(); // sym -> exitTs (não reentrar)

  si = 0;
  for (const [sym, m15] of m15BySym) {
    si++;
    process.stdout.write(`\rSim ${si}/${m15BySym.size} ${sym.padEnd(16)}`);
    const closed = m15.filter((c) => c.t + M15 <= now);
    if (closed.length < RSI_P + RSI_MA_P + 5) continue;
    const closes = closed.map((c) => c.c);
    const rsi = rsiSeries(closes, RSI_P);
    const rsiMa = smaSeries(rsi, RSI_MA_P);

    for (let i = RSI_P + RSI_MA_P + 2; i < closed.length; i++) {
      const bar = closed[i];
      if (bar.t < t0 || bar.t > t1) continue;
      const prev = rsi[i - 1];
      const curr = rsi[i];
      if (prev == null || curr == null) continue;
      if (!(prev >= ENTRY && curr < ENTRY)) continue;
      if (!inUniverse(sym, bar.t)) continue;

      const busyUntil = openUntil.get(sym) ?? 0;
      if (bar.t < busyUntil) continue;

      const tr = simulateTrade(closed, i, rsi, rsiMa);
      trades.push({
        symbol: sym,
        ...tr,
        day: new Date(tr.entryT).toISOString().slice(0, 10),
      });
      openUntil.set(sym, tr.exitT ?? bar.t + M15);
    }
  }
  console.log(`\nTrades: ${trades.length}`);

  trades.sort((a, b) => a.entryT - b.entryT);
  const summary = summarize(trades);

  // Por dia
  const byDay = {};
  for (const t of trades) {
    if (!byDay[t.day]) byDay[t.day] = [];
    byDay[t.day].push(t);
  }
  const daily = Object.keys(byDay)
    .sort()
    .map((d) => {
      const arr = byDay[d];
      const usdt = arr.reduce((a, t) => a + (t.pnl * SIZE) / 100, 0);
      const wins = arr.filter((t) => t.pnl > 0).length;
      return {
        d,
        n: arr.length,
        wr: (100 * wins) / arr.length,
        usdt: +usdt.toFixed(1),
      };
    });
  let cum = 0;
  const equity = daily.map((row) => {
    cum += row.usdt;
    return { ...row, cum: +cum.toFixed(1) };
  });

  // Top símbolos
  const bySym = {};
  for (const t of trades) {
    if (!bySym[t.symbol]) bySym[t.symbol] = [];
    bySym[t.symbol].push(t);
  }
  const topSyms = Object.entries(bySym)
    .map(([symbol, arr]) => {
      const usdt = arr.reduce((a, t) => a + (t.pnl * SIZE) / 100, 0);
      return {
        symbol,
        n: arr.length,
        usdt: +usdt.toFixed(1),
        wr: +((100 * arr.filter((t) => t.pnl > 0).length) / arr.length).toFixed(1),
      };
    })
    .sort((a, b) => b.usdt - a.usdt);

  const payload = {
    meta: {
      from: new Date(t0).toISOString().slice(0, 10),
      to: new Date(t1).toISOString().slice(0, 10),
      days: DAYS,
      rules: {
        timeframe: '15m',
        universe: `Scanner 6 top ${TOP_N} (SMA80 4h)`,
        entry: `RSI(${RSI_P}) cross < ${ENTRY}`,
        sl: SL,
        tp1: { pct: TP1, pos: TP1_POS },
        tp2: { pct: TP2, pos: TP2_POS },
        trail: `RSI×SMA(${RSI_MA_P}) down with RSI>${TRAIL_MIN}`,
        fee: FEE,
        size: SIZE,
      },
      candidates: symbols.length,
      symbolsWithData: m15BySym.size,
    },
    summary,
    daily: equity,
    topSymbols: topSyms.slice(0, 20),
    worstSymbols: [...topSyms].sort((a, b) => a.usdt - b.usdt).slice(0, 10),
    trades: trades.map((t) => ({
      symbol: t.symbol,
      day: t.day,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
      bars: t.bars,
      tp1: t.tp1Hit,
      tp2: t.tp2Hit,
    })),
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log('\n' + '─'.repeat(96));
  console.log(
    `n=${summary.n} WR=${summary.wr.toFixed(1)}% avg=${summary.avg >= 0 ? '+' : ''}${summary.avg.toFixed(2)}% USDT=${summary.usdt >= 0 ? '+' : ''}${summary.usdt.toFixed(0)} PF=${summary.pf.toFixed(2)}`
  );
  console.log(
    `TP1 ${summary.tp1Rate?.toFixed(0)}% | TP2 ${summary.tp2Rate?.toFixed(0)}% | avg bars ${summary.avgBars.toFixed(0)} | Máx+ ${summary.avgFav.toFixed(1)} Máx− ${summary.avgAdv.toFixed(1)}`
  );
  console.log('Paths:', summary.byPath);
  console.log(`Saved ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
