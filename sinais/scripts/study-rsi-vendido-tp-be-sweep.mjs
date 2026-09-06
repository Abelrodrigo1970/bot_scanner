/**
 * rsi_vendido 15m — sweep TP1 8/12/18% + break-even no resto após TP1
 * Entrada original: RSI cruza < 28 · Scanner 6 top 40
 * TP2 +48% 30% · resto RSI×SMA14 down RSI>65 (ou BE)
 *
 * Uso: node scripts/study-rsi-vendido-tp-be-sweep.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const FEE = 0.1;
const SIZE = 100;
const RSI_P = 14;
const RSI_MA_P = 14;
const ENTRY = 28;
const TRAIL_MIN = 65;
const SL = 5;
const TP2 = 48;
const TP1_POS = 30;
const TP2_POS = 30;
const TOP_N = 40;
const DAYS = 60;
const SMA80 = 80;
const H4 = 4 * 3600 * 1000;
const M15 = 15 * 60 * 1000;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, 'cache-rsi-vendido-15m-60d-klines.json');
const OUT = path.join(DIR, 'out-rsi-vendido-tp-be-sweep.json');

const VARIANTS = [
  { tp1: 8, be: true },
  { tp1: 12, be: true },
  { tp1: 18, be: true },
  { tp1: 10, be: true }, // referência BE no TP actual
  { tp1: 10, be: false }, // baseline produção
];

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

function simulateTrade(c15, entryIdx, rsi, rsiMa, tp1Pct, useBe) {
  const entry = c15[entryIdx].c;
  const entryT = c15[entryIdx].t;
  let slPx = entry * (1 - SL / 100);
  const tp1Px = entry * (1 + tp1Pct / 100);
  const tp2Px = entry * (1 + TP2 / 100);
  const bePx = entry;

  let rem = 100;
  let pnlWeighted = 0;
  let tp1Hit = false;
  let tp2Hit = false;
  let path = 'OPEN';
  let exitT = null;
  let bars = 0;

  for (let i = entryIdx + 1; i < c15.length; i++) {
    const bar = c15[i];
    bars++;

    // SL / BE (conservador: stop antes de novos TPs no mesmo bar)
    if (bar.l <= slPx) {
      const stopPct = tp1Hit && useBe ? 0 : -SL;
      pnlWeighted += (rem / 100) * stopPct;
      rem = 0;
      path = tp1Hit ? (useBe ? 'BE' : 'SL_AFTER_TP') : 'SL';
      exitT = bar.t;
      break;
    }

    if (!tp1Hit && bar.h >= tp1Px) {
      pnlWeighted += (TP1_POS / 100) * tp1Pct;
      rem -= TP1_POS;
      tp1Hit = true;
      if (useBe) slPx = bePx;
      // mesmo bar: se low já passou BE/entry após TP1
      if (useBe && rem > 0 && bar.l <= bePx) {
        pnlWeighted += 0;
        rem = 0;
        path = 'BE';
        exitT = bar.t;
        break;
      }
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
        path = tp1Hit ? 'RSI_MA_AFTER_TP' : 'RSI_MA';
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
    bars,
    entryT,
    exitT,
    tp1Hit,
    tp2Hit,
  };
}

function summarize(trades) {
  if (!trades.length) {
    return { n: 0, wr: 0, avg: 0, usdt: 0, pf: 0, byPath: {}, tp1Rate: 0, tp2Rate: 0 };
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
    tp1Rate: (100 * trades.filter((t) => t.tp1Hit).length) / trades.length,
    tp2Rate: (100 * trades.filter((t) => t.tp2Hit).length) / trades.length,
    beCount: trades.filter((t) => t.path === 'BE').length,
    slCount: trades.filter((t) => t.path === 'SL' || t.path === 'SL_AFTER_TP').length,
  };
}

function main() {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8'));
  const h4BySym = new Map(Object.entries(raw.h4));
  const m15BySym = new Map(Object.entries(raw.m15));
  const now = Date.now();
  const t0 = now - DAYS * 24 * 3600 * 1000;
  const t1 = now;

  console.log('═'.repeat(96));
  console.log(
    `TP1 sweep + BE · RSI cross <${ENTRY} · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );
  console.log(`Cache: ${m15BySym.size} símbolos | TP1 ∈ {8,12,18} (+ ref 10) | BE após TP1`);
  console.log('═'.repeat(96));

  const universeAt = new Map();
  const h4Times = new Set();
  for (const h4 of h4BySym.values()) {
    for (const b of h4) {
      if (b.t >= t0 - H4 && b.t <= t1) h4Times.add(b.t);
    }
  }
  const sortedH4 = [...h4Times].sort((a, b) => a - b);
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
      rows.push({ sym, pctFromMa: ((close - ma) / ma) * 100 });
    }
    rows.sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));
    universeAt.set(ts, new Set(rows.slice(0, TOP_N).map((r) => r.sym)));
  }

  function inUniverse(sym, barT) {
    const closed4hOpen = Math.floor(barT / H4) * H4;
    let ts = closed4hOpen - H4;
    if (barT + M15 >= closed4hOpen + H4) ts = closed4hOpen;
    if (universeAt.has(ts)) return universeAt.get(ts).has(sym);
    let best = null;
    for (const k of universeAt.keys()) {
      if (k <= ts && (best == null || k > best)) best = k;
    }
    if (best == null) return false;
    return universeAt.get(best).has(sym);
  }

  // Simular cada variante
  const results = [];
  for (const v of VARIANTS) {
    const trades = [];
    const openUntil = new Map();

    let si = 0;
    for (const [sym, m15] of m15BySym) {
      si++;
      if (si % 40 === 0) process.stdout.write(`\rTP1 ${v.tp1} BE=${v.be} ${si}/${m15BySym.size}`);
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
        const busy = openUntil.get(sym) ?? 0;
        if (bar.t < busy) continue;

        const tr = simulateTrade(closed, i, rsi, rsiMa, v.tp1, v.be);
        trades.push({
          symbol: sym,
          ...tr,
          day: new Date(tr.entryT).toISOString().slice(0, 10),
        });
        openUntil.set(sym, tr.exitT ?? bar.t + M15);
      }
    }
    process.stdout.write(`\rTP1 ${v.tp1} BE=${v.be} done${' '.repeat(20)}\n`);

    trades.sort((a, b) => a.entryT - b.entryT);
    const summary = summarize(trades);
    const byDay = {};
    for (const t of trades) {
      if (!byDay[t.day]) byDay[t.day] = [];
      byDay[t.day].push(t);
    }
    let cum = 0;
    const daily = Object.keys(byDay)
      .sort()
      .map((d) => {
        const usdt = byDay[d].reduce((a, x) => a + (x.pnl * SIZE) / 100, 0);
        cum += usdt;
        return { d, n: byDay[d].length, usdt: +usdt.toFixed(1), cum: +cum.toFixed(1) };
      });

    const label = `TP1 +${v.tp1}%${v.be ? ' + BE' : ' (sem BE)'}`;
    results.push({
      label,
      tp1: v.tp1,
      be: v.be,
      summary,
      daily,
      byPath: summary.byPath,
    });

    console.log(
      `${label.padEnd(22)} n=${summary.n} WR=${summary.wr.toFixed(1)}% avg=${summary.avg >= 0 ? '+' : ''}${summary.avg.toFixed(2)}% USDT=${summary.usdt >= 0 ? '+' : ''}${summary.usdt.toFixed(0)} PF=${summary.pf.toFixed(2)} TP1=${summary.tp1Rate.toFixed(0)}% BE=${summary.beCount} SL=${summary.slCount}`
    );
  }

  const payload = {
    meta: {
      from: new Date(t0).toISOString().slice(0, 10),
      to: new Date(t1).toISOString().slice(0, 10),
      entry: `RSI cross < ${ENTRY}`,
      tp2: TP2,
      tp1Pos: TP1_POS,
      tp2Pos: TP2_POS,
      sl: SL,
      be: 'SL → entry após TP1',
    },
    results: results.map((r) => ({
      label: r.label,
      tp1: r.tp1,
      be: r.be,
      summary: {
        n: r.summary.n,
        wr: +r.summary.wr.toFixed(1),
        avg: +r.summary.avg.toFixed(2),
        usdt: +r.summary.usdt.toFixed(0),
        pf: +r.summary.pf.toFixed(2),
        tp1Rate: +r.summary.tp1Rate.toFixed(1),
        tp2Rate: +r.summary.tp2Rate.toFixed(1),
        beCount: r.summary.beCount,
        slCount: r.summary.slCount,
        byPath: r.summary.byPath,
      },
      daily: r.daily,
    })),
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`\nSaved ${OUT}`);
}

main();
