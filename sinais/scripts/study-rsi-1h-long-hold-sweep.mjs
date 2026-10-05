/**
 * rsi_1h_long · hold residual sweep (72h / 4d / 5d)
 * Entrada: EMA12 cross↑ + RSI azul <40 + dist EMA70 1d <40% · S1 completo
 * TP1 +19%@30% · TP2 +39%@50% · SL −7%
 * Resto: 72h vs 96h (4d) vs 120h (5d) vs 15d
 *
 * Uso:
 *   node scripts/study-rsi-1h-long-hold-sweep.mjs
 *   node scripts/study-rsi-1h-long-hold-sweep.mjs --days=90
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const FEE = 0.1;
const SIZE = 100;
const H1 = 3600_000;
const SNAP_MS = 4 * 3600_000;
const DAY_MS = 86400_000;

const EMA_PERIOD = 12;
const RSI_PERIOD = 14;
const RSI_MA_PERIOD = 14;
const RSI_MA_MAX = 40;
const EMA_DAILY = 70;
const MAX_DIST_EMA70 = 40;
const SL_PCT = 7;
const TP1_PCT = 19;
const TP1_POS = 0.3;
const TP2_PCT = 39;
const TP2_POS = 0.5;

const HOLD_VARIANTS = [
  { hours: 72, label: '72h (live)' },
  { hours: 96, label: '4 dias (96h)' },
  { hours: 120, label: '5 dias (120h)' },
  { hours: 360, label: '15 dias (360h)' },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const daysArg = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] || 90);

function resolveCache() {
  const preferred = [
    path.join(__dirname, 'cache-strategies-universe-fit-90d-c100.json'),
    path.join(__dirname, `cache-strategies-universe-fit-${daysArg}d-c100.json`),
  ];
  for (const p of preferred) if (existsSync(p)) return p;
  return preferred[0];
}
const CACHE = resolveCache();
const OUT = path.join(__dirname, `out-rsi-1h-long-hold-sweep-${daysArg}d.json`);
const HTML = path.join(__dirname, `rsi-1h-long-hold-sweep-${daysArg}d.html`);

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
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function rsiMaSeries(rsi, period) {
  const out = new Array(rsi.length).fill(null);
  for (let i = 0; i < rsi.length; i++) {
    if (rsi[i] == null) continue;
    let ok = true;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (j < 0 || rsi[j] == null) {
        ok = false;
        break;
      }
      sum += rsi[j];
    }
    if (ok) out[i] = sum / period;
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

function monthKey(t) {
  return new Date(t).toISOString().slice(0, 7);
}

function buildS1Snaps(d1BySym, startMs, endMs) {
  const snaps = new Map();
  const ema70 = new Map();
  for (const [sym, bars] of d1BySym) {
    ema70.set(
      sym,
      emaSeries(
        bars.map((b) => b.c),
        EMA_DAILY
      )
    );
  }
  const from = alignDown(startMs, SNAP_MS);
  for (let t = from; t <= endMs; t += SNAP_MS) {
    const set = new Set();
    for (const [sym, d1] of d1BySym) {
      const i = findIdxAtOrBefore(d1, t);
      if (i < 0) continue;
      const ema = ema70.get(sym)?.[i];
      const c = d1[i].c;
      if (ema != null && ema > 0 && c > ema) set.add(sym);
    }
    snaps.set(t, set);
  }
  return snaps;
}

function inS1(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set ? set.has(sym) : false;
}

function distEma70Daily(d1, ema70Arr, t, price) {
  const i = findIdxAtOrBefore(d1, t);
  if (i < 0) return null;
  const ema = ema70Arr[i];
  if (ema == null || !(ema > 0) || !(price > 0)) return null;
  return (price / ema - 1) * 100;
}

function closeAtOrBefore(candles, endT, fromIdx) {
  let last = candles[fromIdx];
  for (let i = fromIdx; i < candles.length; i++) {
    if (candles[i].t <= endT) last = candles[i];
    else break;
  }
  return last;
}

function walkExit(h1, entryIdx, entry, holdH) {
  const tp1 = entry * (1 + TP1_PCT / 100);
  const tp2 = entry * (1 + TP2_PCT / 100);
  const sl = entry * (1 - SL_PCT / 100);
  const endT = h1[entryIdx].t + holdH * H1;

  let hit1 = false;
  let hit2 = false;
  let locked = 0;
  let rem = 1;

  for (let i = entryIdx + 1; i < h1.length; i++) {
    const b = h1[i];
    if (b.t > endT) break;

    if (rem > 0 && b.l <= sl) {
      return {
        pnl: locked + rem * -SL_PCT - FEE,
        path: hit1 || hit2 ? 'TP+SL' : 'SL',
        exitT: b.t,
        hit1,
        hit2,
        timedOnly: false,
      };
    }

    if (!hit1 && b.h >= tp1) {
      hit1 = true;
      locked += TP1_POS * TP1_PCT;
      rem -= TP1_POS;
    }
    if (!hit2 && b.h >= tp2) {
      hit2 = true;
      locked += TP2_POS * TP2_PCT;
      rem -= TP2_POS;
    }
    if (rem <= 1e-9) {
      return {
        pnl: locked - FEE,
        path: hit1 && hit2 ? 'TP1+TP2' : hit1 ? 'TP1' : 'TP2',
        exitT: b.t,
        hit1,
        hit2,
        timedOnly: false,
      };
    }
  }

  const last = closeAtOrBefore(h1, endT, entryIdx);
  const closeP = ((last.c - entry) / entry) * 100;
  let path = `${holdH}h`;
  if (hit1 && hit2) path = `TP1+TP2+${holdH}h`;
  else if (hit1) path = `TP1+${holdH}h`;
  else if (hit2) path = `TP2+${holdH}h`;

  return {
    pnl: locked + rem * closeP - FEE,
    path,
    exitT: last.t,
    hit1,
    hit2,
    timedOnly: !hit1 && !hit2,
  };
}

function collectEntries(h1BySym, d1BySym, snaps, t0, t1) {
  const entries = [];
  const ema70BySym = new Map();
  for (const [sym, d1] of d1BySym) {
    ema70BySym.set(
      sym,
      emaSeries(
        d1.map((b) => b.c),
        EMA_DAILY
      )
    );
  }

  for (const [sym, h1] of h1BySym) {
    if (!h1?.length) continue;
    const d1 = d1BySym.get(sym);
    const ema70Arr = ema70BySym.get(sym);
    if (!d1 || !ema70Arr) continue;

    const closes = h1.map((b) => b.c);
    const emaArr = emaSeries(closes, EMA_PERIOD);
    const rsiArr = rsiSeries(closes, RSI_PERIOD);
    const rsiMaArr = rsiMaSeries(rsiArr, RSI_MA_PERIOD);

    for (let i = 1; i < h1.length; i++) {
      if (h1[i].t < t0 || h1[i].t > t1) continue;

      const ema = emaArr[i];
      const emaPrev = emaArr[i - 1];
      const rsiMa = rsiMaArr[i];
      if (ema == null || emaPrev == null || !(ema > 0) || !(emaPrev > 0)) continue;
      if (!(rsiMa != null && rsiMa < RSI_MA_MAX)) continue;

      const prevClose = closes[i - 1];
      const close = closes[i];
      if (!(prevClose <= emaPrev && close > ema)) continue;
      if (!inS1(snaps, h1[i].t, sym)) continue;

      const dist = distEma70Daily(d1, ema70Arr, h1[i].t, close);
      if (dist == null || !(dist < MAX_DIST_EMA70)) continue;

      entries.push({
        sym,
        i,
        t: h1[i].t,
        month: monthKey(h1[i].t),
        entry: close,
      });
    }
  }

  entries.sort((a, b) => a.t - b.t);
  return entries;
}

function runVariant(entries, h1BySym, holdH) {
  const trades = [];
  const busyUntil = new Map();
  for (const e of entries) {
    if ((busyUntil.get(e.sym) || 0) > e.t) continue;
    const h1 = h1BySym.get(e.sym);
    if (!h1) continue;
    const walk = walkExit(h1, e.i, e.entry, holdH);
    busyUntil.set(e.sym, walk.exitT);
    trades.push({
      sym: e.sym,
      t: e.t,
      month: e.month,
      pnl: +walk.pnl.toFixed(4),
      usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
      path: walk.path,
      holdH: +((walk.exitT - e.t) / H1).toFixed(2),
      hit1: walk.hit1,
      hit2: walk.hit2,
      timedOnly: walk.timedOnly,
    });
  }
  return trades;
}

function summarize(label, trades, holdH) {
  if (!trades.length) {
    return {
      label,
      holdH,
      n: 0,
      avg: 0,
      usdt: 0,
      wr: 0,
      pf: 0,
      maxDd: 0,
      avgHoldH: 0,
      hit1Rate: 0,
      hit2Rate: 0,
      timedOnlyN: 0,
      timedOnlyPct: 0,
      anyTimedN: 0,
      byPath: {},
    };
  }
  let sum = 0;
  let winSum = 0;
  let lossSum = 0;
  let holdSum = 0;
  let hit1 = 0;
  let hit2 = 0;
  let wins = 0;
  let timedOnly = 0;
  let anyTimed = 0;
  const byPath = {};
  for (const t of trades) {
    sum += t.pnl;
    holdSum += t.holdH || 0;
    if (t.hit1) hit1++;
    if (t.hit2) hit2++;
    if (t.timedOnly) timedOnly++;
    if (String(t.path).includes(`${holdH}h`)) anyTimed++;
    if (t.pnl > 0) {
      wins++;
      winSum += t.pnl;
    } else lossSum += Math.abs(t.pnl);
    byPath[t.path] = (byPath[t.path] || 0) + 1;
  }
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    eq += t.pnl;
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak - eq);
  }
  return {
    label,
    holdH,
    n: trades.length,
    avg: +(sum / trades.length).toFixed(2),
    usdt: +((sum * SIZE) / 100).toFixed(1),
    wr: +((100 * wins) / trades.length).toFixed(1),
    pf: lossSum > 0 ? +(winSum / lossSum).toFixed(2) : winSum > 0 ? null : 0,
    maxDd: +maxDd.toFixed(1),
    avgHoldH: +(holdSum / trades.length).toFixed(1),
    hit1Rate: +((100 * hit1) / trades.length).toFixed(1),
    hit2Rate: +((100 * hit2) / trades.length).toFixed(1),
    timedOnlyN: timedOnly,
    timedOnlyPct: +((100 * timedOnly) / trades.length).toFixed(1),
    anyTimedN: anyTimed,
    byPath,
  };
}

function main() {
  if (!existsSync(CACHE)) {
    console.error('Cache em falta:', CACHE);
    process.exit(1);
  }

  console.log('A carregar', CACHE);
  const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  const h1BySym = new Map();
  const d1BySym = new Map();
  for (const sym of cache.symbols || Object.keys(cache.h1BySym || {})) {
    if (cache.h1BySym?.[sym]) h1BySym.set(sym, cache.h1BySym[sym]);
    if (cache.d1BySym?.[sym]) d1BySym.set(sym, cache.d1BySym[sym]);
  }

  let tEnd = 0;
  for (const bars of h1BySym.values()) {
    if (bars.length) tEnd = Math.max(tEnd, bars[bars.length - 1].t);
  }
  const t1 = tEnd - H1;
  const t0 = t1 - daysArg * DAY_MS;

  console.log(
    `rsi_1h_long hold sweep · TP 19/39 | ${daysArg}d | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );

  const snaps = buildS1Snaps(d1BySym, t0, t1);
  const entries = collectEntries(h1BySym, d1BySym, snaps, t0, t1);
  console.log(`Candidatos: ${entries.length}`);

  const results = [];
  for (const v of HOLD_VARIANTS) {
    const trades = runVariant(entries, h1BySym, v.hours);
    const sum = summarize(v.label, trades, v.hours);
    results.push(sum);
    const pf = sum.pf == null ? '∞' : sum.pf;
    console.log(
      `  ${v.label.padEnd(16)} n=${sum.n}  WR=${String(sum.wr).padStart(5)}%  avg=${(sum.avg >= 0 ? '+' : '') + sum.avg.toFixed(2)}%  USDT=${(sum.usdt >= 0 ? '+' : '') + String(sum.usdt).padStart(7)}  PF=${pf}  só-timed=${sum.timedOnlyN} (${sum.timedOnlyPct}%)  TP1=${sum.hit1Rate}% TP2=${sum.hit2Rate}%  DD=${sum.maxDd}`
    );
  }

  const best = [...results].sort((a, b) => b.usdt - a.usdt)[0];
  const live = results.find((r) => r.holdH === 72);

  const html = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"/>
<title>rsi_1h_long hold sweep ${daysArg}d</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;background:#111;color:#eee}
h1{font-size:22px;margin:0 0 8px}p{color:#aaa;font-size:14px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.stat{background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:12px 16px}
.stat b{display:block;font-size:20px;margin-top:4px}.stat span{font-size:12px;color:#888}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{background:#222}.ok{color:#3dd68c}.bad{color:#f87171}.best{background:#1a2e1a}
</style></head><body>
<h1>rsi_1h_long — fecho residual 72h vs 4d vs 5d</h1>
<p>${daysArg}d · TP +19%@30% +39%@50% · SL −${SL_PCT}% · S1 completo · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}</p>
<div class="stats">
  <div class="stat"><span>Melhor</span><b class="ok">${best.label} → ${best.usdt}</b></div>
  ${live ? `<div class="stat"><span>Live 72h</span><b>${live.usdt}</b></div>` : ''}
  ${live && best.holdH !== 72 ? `<div class="stat"><span>Delta vs 72h</span><b class="${best.usdt - live.usdt >= 0 ? 'ok' : 'bad'}">${(best.usdt - live.usdt >= 0 ? '+' : '') + (best.usdt - live.usdt).toFixed(1)}</b></div>` : ''}
</div>
<table>
<thead><tr><th>Hold</th><th>n</th><th>WR</th><th>USDT</th><th>avg%</th><th>PF</th><th>MaxDD</th><th>só timed</th><th>TP1%</th><th>TP2%</th><th>Hold médio</th></tr></thead>
<tbody>
${results
  .map((r) => {
    const cls = r === best ? 'best' : '';
    return `<tr class="${cls}"><td>${r.label}</td><td>${r.n}</td><td>${r.wr}%</td><td class="${r.usdt >= 0 ? 'ok' : 'bad'}">${r.usdt}</td><td>${r.avg}</td><td>${r.pf ?? '∞'}</td><td>${r.maxDd}</td><td>${r.timedOnlyN} (${r.timedOnlyPct}%)</td><td>${r.hit1Rate}</td><td>${r.hit2Rate}</td><td>${r.avgHoldH}h</td></tr>`;
  })
  .join('\n')}
</tbody></table>
</body></html>`;

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        meta: {
          strategy: 'RSI_1H_LONG',
          days: daysArg,
          from: new Date(t0).toISOString(),
          to: new Date(t1).toISOString(),
          tp1Pct: TP1_PCT,
          tp2Pct: TP2_PCT,
          slPct: SL_PCT,
          holds: HOLD_VARIANTS.map((v) => v.hours),
          cache: path.basename(CACHE),
        },
        best: { holdH: best.holdH, label: best.label, usdt: best.usdt, wr: best.wr, pf: best.pf },
        results,
      },
      null,
      2
    )
  );
  writeFileSync(HTML, html);
  console.log(`\nMelhor: ${best.label} → USDT ${best.usdt}`);
  console.log(`Escrito ${path.basename(OUT)} | ${path.basename(HTML)}`);
}

main();
