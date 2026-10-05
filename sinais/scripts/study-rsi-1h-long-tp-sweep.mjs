/**
 * Sweep TP rsi_1h_long · Scanner 1 completo · 90d
 * Entrada fixa: EMA12 cross↑ + RSI azul < 40 + dist EMA70 1d < 40%
 * Saída: TP1 @30% × {8,15,19}% × TP2 @50% × {28,39}% · resto 72h · SL −7%
 *
 * Uso:
 *   node scripts/study-rsi-1h-long-tp-sweep.mjs
 *   node scripts/study-rsi-1h-long-tp-sweep.mjs --days=90
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
const HOLD_H = 72;
const TP1_POS = 0.3;
const TP2_POS = 0.5;

const TP1_LEVELS = [8, 15, 19];
const TP2_LEVELS = [28, 39];
/** Baseline live actual (19/39) para comparar. */
const BASELINE = { tp1: 19, tp2: 39 };

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
const OUT = path.join(__dirname, `out-rsi-1h-long-tp-sweep-${daysArg}d.json`);
const HTML = path.join(__dirname, `rsi-1h-long-tp-sweep-${daysArg}d.html`);

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

function walkExit(h1, entryIdx, entry, tp1Pct, tp2Pct) {
  const tp1 = entry * (1 + tp1Pct / 100);
  const tp2 = entry * (1 + tp2Pct / 100);
  const sl = entry * (1 - SL_PCT / 100);
  const endT = h1[entryIdx].t + HOLD_H * H1;

  let hit1 = false;
  let hit2 = false;
  let locked = 0;
  let rem = 1;
  let maxFav = 0;
  let maxAdv = 0;

  for (let i = entryIdx + 1; i < h1.length; i++) {
    const b = h1[i];
    if (b.t > endT) break;

    const fav = ((b.h - entry) / entry) * 100;
    const adv = ((entry - b.l) / entry) * 100;
    if (fav > maxFav) maxFav = fav;
    if (adv > maxAdv) maxAdv = adv;

    if (rem > 0 && b.l <= sl) {
      return {
        pnl: locked + rem * -SL_PCT - FEE,
        path: hit1 || hit2 ? 'TP+SL' : 'SL',
        exitT: b.t,
        hit1,
        hit2,
        maxFav,
        maxAdv,
      };
    }

    if (!hit1 && b.h >= tp1) {
      hit1 = true;
      locked += TP1_POS * tp1Pct;
      rem -= TP1_POS;
    }
    if (!hit2 && b.h >= tp2) {
      hit2 = true;
      locked += TP2_POS * tp2Pct;
      rem -= TP2_POS;
    }
    if (rem <= 1e-9) {
      return {
        pnl: locked - FEE,
        path: hit1 && hit2 ? 'TP1+TP2' : hit1 ? 'TP1' : 'TP2',
        exitT: b.t,
        hit1,
        hit2,
        maxFav,
        maxAdv,
      };
    }
  }

  const last = closeAtOrBefore(h1, endT, entryIdx);
  const closeP = ((last.c - entry) / entry) * 100;
  let path = `${HOLD_H}h`;
  if (hit1 && hit2) path = `TP1+TP2+${HOLD_H}h`;
  else if (hit1) path = `TP1+${HOLD_H}h`;
  else if (hit2) path = `TP2+${HOLD_H}h`;

  return {
    pnl: locked + rem * closeP - FEE,
    path,
    exitT: last.t,
    hit1,
    hit2,
    maxFav,
    maxAdv,
  };
}

/** Candidatos de entrada (sem lock de posição — cada variante gere a sua). */
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
        rsiMa: +rsiMa.toFixed(2),
        distEma70: +dist.toFixed(2),
      });
    }
  }

  entries.sort((a, b) => a.t - b.t);
  return entries;
}

function runVariant(entries, h1BySym, tp1, tp2) {
  const trades = [];
  const busyUntil = new Map();
  for (const e of entries) {
    if ((busyUntil.get(e.sym) || 0) > e.t) continue;
    const h1 = h1BySym.get(e.sym);
    if (!h1) continue;
    const walk = walkExit(h1, e.i, e.entry, tp1, tp2);
    busyUntil.set(e.sym, walk.exitT);
    trades.push({
      sym: e.sym,
      t: e.t,
      month: e.month,
      entry: e.entry,
      pnl: +walk.pnl.toFixed(4),
      usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
      path: walk.path,
      holdH: +((walk.exitT - e.t) / H1).toFixed(2),
      hit1: walk.hit1,
      hit2: walk.hit2,
      maxFav: +walk.maxFav.toFixed(2),
      maxAdv: +walk.maxAdv.toFixed(2),
      rsiMa: e.rsiMa,
      distEma70: e.distEma70,
    });
  }
  return trades;
}

function summarize(label, trades, tp1, tp2) {
  if (!trades.length) {
    return {
      label,
      tp1,
      tp2,
      n: 0,
      avg: 0,
      usdt: 0,
      wr: 0,
      pf: 0,
      maxDd: 0,
      avgHoldH: 0,
      hit1Rate: 0,
      hit2Rate: 0,
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
  const byPath = {};
  for (const t of trades) {
    sum += t.pnl;
    holdSum += t.holdH || 0;
    if (t.hit1) hit1++;
    if (t.hit2) hit2++;
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
    tp1,
    tp2,
    n: trades.length,
    avg: +(sum / trades.length).toFixed(2),
    usdt: +((sum * SIZE) / 100).toFixed(1),
    wr: +((100 * wins) / trades.length).toFixed(1),
    pf: lossSum > 0 ? +(winSum / lossSum).toFixed(2) : winSum > 0 ? null : 0,
    maxDd: +maxDd.toFixed(1),
    avgHoldH: +(holdSum / trades.length).toFixed(1),
    hit1Rate: +((100 * hit1) / trades.length).toFixed(1),
    hit2Rate: +((100 * hit2) / trades.length).toFixed(1),
    byPath,
  };
}

function byMonth(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!m.has(t.month)) m.set(t.month, []);
    m.get(t.month).push(t);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, list]) => {
      const s = summarize(month, list, null, null);
      return { month, n: s.n, wr: s.wr, usdt: s.usdt, avg: s.avg };
    });
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
    `rsi_1h_long TP sweep · S1 completo | ${daysArg}d | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );
  console.log(
    `TP1@${TP1_POS * 100}% ∈ {${TP1_LEVELS.join(',')}} · TP2@${TP2_POS * 100}% ∈ {${TP2_LEVELS.join(',')}} · resto ${HOLD_H}h · SL −${SL_PCT}%`
  );

  const snaps = buildS1Snaps(d1BySym, t0, t1);
  const entries = collectEntries(h1BySym, d1BySym, snaps, t0, t1);
  console.log(`Entradas: ${entries.length}`);

  const combos = [];
  for (const tp1 of TP1_LEVELS) {
    for (const tp2 of TP2_LEVELS) {
      combos.push({ tp1, tp2, baseline: false });
    }
  }
  combos.push({ ...BASELINE, baseline: true });

  const results = [];
  for (const c of combos) {
    const trades = runVariant(entries, h1BySym, c.tp1, c.tp2);
    const label = c.baseline
      ? `live TP1 +${c.tp1}% / TP2 +${c.tp2}%`
      : `TP1 +${c.tp1}% / TP2 +${c.tp2}%`;
    const sum = summarize(label, trades, c.tp1, c.tp2);
    results.push({
      ...sum,
      baseline: c.baseline,
      months: byMonth(trades),
    });
    const pf = sum.pf == null ? '∞' : sum.pf;
    console.log(
      `  ${label.padEnd(32)} n=${sum.n}  WR=${String(sum.wr).padStart(5)}%  avg=${(sum.avg >= 0 ? '+' : '') + sum.avg.toFixed(2)}%  USDT=${(sum.usdt >= 0 ? '+' : '') + String(sum.usdt).padStart(7)}  PF=${pf}  TP1=${sum.hit1Rate}% TP2=${sum.hit2Rate}%  DD=${sum.maxDd}`
    );
  }

  const sweepOnly = results.filter((r) => !r.baseline);
  const best = [...sweepOnly].sort((a, b) => b.usdt - a.usdt)[0];
  const baseline = results.find((r) => r.baseline);

  const html = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"/>
<title>rsi_1h_long TP sweep ${daysArg}d</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;background:#111;color:#eee}
h1{font-size:22px;margin:0 0 8px}p{color:#aaa;font-size:14px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.stat{background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:12px 16px}
.stat b{display:block;font-size:20px;margin-top:4px}.stat span{font-size:12px;color:#888}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{background:#222}.ok{color:#3dd68c}.bad{color:#f87171}.best{background:#1a2e1a}.base{background:#1a1a2e}
</style></head><body>
<h1>rsi_1h_long — sweep TP1 × TP2</h1>
<p>${daysArg}d · S1 completo · EMA12↑ + RSI azul &lt;40 · dist EMA70d &lt;40% · TP1@30% × {${TP1_LEVELS.join(',')}} · TP2@50% × {${TP2_LEVELS.join(',')}} · resto ${HOLD_H}h · SL −${SL_PCT}% · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}</p>
<div class="stats">
  <div class="stat"><span>Entradas</span><b>${entries.length}</b></div>
  <div class="stat"><span>Melhor USDT</span><b class="ok">+${best.tp1}/${best.tp2} → ${best.usdt}</b></div>
  ${baseline ? `<div class="stat"><span>Live 12/48</span><b class="${baseline.usdt >= 0 ? 'ok' : 'bad'}">${baseline.usdt}</b></div>` : ''}
</div>
<table>
<thead><tr><th>Variante</th><th>n</th><th>WR</th><th>USDT</th><th>avg%</th><th>PF</th><th>MaxDD</th><th>TP1%</th><th>TP2%</th><th>Hold</th></tr></thead>
<tbody>
${results
  .map((r) => {
    const cls = r.baseline ? 'base' : r === best ? 'best' : '';
    return `<tr class="${cls}"><td>${r.label}</td><td>${r.n}</td><td>${r.wr}%</td><td class="${r.usdt >= 0 ? 'ok' : 'bad'}">${r.usdt}</td><td>${r.avg}</td><td>${r.pf ?? '∞'}</td><td>${r.maxDd}</td><td>${r.hit1Rate}</td><td>${r.hit2Rate}</td><td>${r.avgHoldH}h</td></tr>`;
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
          tp1Levels: TP1_LEVELS,
          tp2Levels: TP2_LEVELS,
          tp1Pos: TP1_POS,
          tp2Pos: TP2_POS,
          holdH: HOLD_H,
          slPct: SL_PCT,
          entries: entries.length,
          cache: path.basename(CACHE),
        },
        best: { tp1: best.tp1, tp2: best.tp2, usdt: best.usdt, wr: best.wr, pf: best.pf },
        baseline: baseline
          ? { tp1: baseline.tp1, tp2: baseline.tp2, usdt: baseline.usdt, wr: baseline.wr, pf: baseline.pf }
          : null,
        results,
      },
      null,
      2
    )
  );
  writeFileSync(HTML, html);
  console.log(`\nMelhor: TP1 +${best.tp1}% / TP2 +${best.tp2}% → USDT ${best.usdt}`);
  console.log(`Escrito ${path.basename(OUT)} | ${path.basename(HTML)}`);
}

main();
