/**
 * Estudo rsi_1h_long · Scanner 1 completo · 90d
 * Entrada: fecho 1h cruza EMA12↑ + RSI azul < 40 + dist EMA70 1d < 40%
 * Saída: TP1 +19%@30% | TP2 +39%@50% | resto 72h | SL −7%
 *
 * Uso:
 *   node scripts/study-rsi-1h-long-90d.mjs
 *   node scripts/study-rsi-1h-long-90d.mjs --days=90
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
const MAX_DIST_EMA70 = 40; // %
const SL_PCT = 7;
const HOLD_H = 72;
const TP1_PCT = 19;
const TP1_POS = 0.3;
const TP2_PCT = 39;
const TP2_POS = 0.5;

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
const OUT = path.join(__dirname, `out-rsi-1h-long-${daysArg}d.json`);
const HTML = path.join(__dirname, `rsi-1h-long-${daysArg}d.html`);

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

/** Scanner 1 completo: todos com fecho 1d > EMA70 (sem top N). */
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

/** Distância % ao EMA70 diário no instante t (última barra 1d ≤ t). */
function distEma70Daily(d1, ema70Arr, t, price) {
  const i = findIdxAtOrBefore(d1, t);
  if (i < 0) return null;
  const ema = ema70Arr[i];
  if (ema == null || !(ema > 0) || !(price > 0)) return null;
  return ((price / ema - 1) * 100);
}

function closeAtOrBefore(candles, endT, fromIdx) {
  let last = candles[fromIdx];
  for (let i = fromIdx; i < candles.length; i++) {
    if (candles[i].t <= endT) last = candles[i];
    else break;
  }
  return last;
}

/**
 * TP1 +19%@30% · TP2 +39%@50% · resto @72h · SL −7%.
 * Same-bar: SL antes de TP.
 */
function walkExit(h1, entryIdx, entry) {
  const tp1 = entry * (1 + TP1_PCT / 100);
  const tp2 = entry * (1 + TP2_PCT / 100);
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
      const path = hit1 || hit2 ? 'TP+SL' : 'SL';
      return {
        pnl: locked + rem * -SL_PCT - FEE,
        path,
        exitT: b.t,
        exit: sl,
        hit1,
        hit2,
        maxFav,
        maxAdv,
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
        exit: hit2 ? tp2 : tp1,
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
    exit: last.c,
    hit1,
    hit2,
    maxFav,
    maxAdv,
  };
}

function collectTrades(h1BySym, d1BySym, snaps, t0, t1) {
  const trades = [];
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

    let openUntil = -1;

    for (let i = 1; i < h1.length; i++) {
      if (h1[i].t < t0 || h1[i].t > t1) continue;
      if (i <= openUntil) continue;

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

      const entry = close;
      const walk = walkExit(h1, i, entry);
      const holdH = (walk.exitT - h1[i].t) / H1;
      openUntil = findIdxAtOrBefore(h1, walk.exitT);

      trades.push({
        sym,
        t: h1[i].t,
        month: monthKey(h1[i].t),
        entry,
        exit: walk.exit,
        exitT: walk.exitT,
        pnl: +walk.pnl.toFixed(4),
        usdt: +((walk.pnl * SIZE) / 100).toFixed(2),
        path: walk.path,
        holdH: +holdH.toFixed(2),
        rsi: rsiArr[i] != null ? +rsiArr[i].toFixed(2) : null,
        rsiMa: +rsiMa.toFixed(2),
        distEma70: +dist.toFixed(2),
        hit1: walk.hit1,
        hit2: walk.hit2,
        maxFav: +walk.maxFav.toFixed(2),
        maxAdv: +walk.maxAdv.toFixed(2),
      });
    }
  }

  trades.sort((a, b) => a.t - b.t);
  return trades;
}

function summarize(label, trades) {
  if (!trades.length) {
    return {
      label,
      n: 0,
      avg: 0,
      usdt: 0,
      wr: 0,
      pf: 0,
      maxDd: 0,
      avgHoldH: 0,
      avgFav: 0,
      avgAdv: 0,
      hit1Rate: 0,
      hit2Rate: 0,
      byPath: {},
    };
  }
  let sum = 0;
  let winSum = 0;
  let lossSum = 0;
  let holdSum = 0;
  let favSum = 0;
  let advSum = 0;
  let hit1 = 0;
  let hit2 = 0;
  const wins = [];
  const byPath = {};
  for (const t of trades) {
    sum += t.pnl;
    holdSum += t.holdH || 0;
    favSum += t.maxFav || 0;
    advSum += t.maxAdv || 0;
    if (t.hit1) hit1++;
    if (t.hit2) hit2++;
    if (t.pnl > 0) {
      wins.push(t);
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
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: wins.length / trades.length,
    pf: lossSum > 0 ? winSum / lossSum : winSum > 0 ? Infinity : 0,
    maxDd,
    avgHoldH: holdSum / trades.length,
    avgFav: favSum / trades.length,
    avgAdv: advSum / trades.length,
    hit1Rate: hit1 / trades.length,
    hit2Rate: hit2 / trades.length,
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
      const s = summarize(month, list);
      return {
        month,
        n: s.n,
        wr: +(s.wr * 100).toFixed(1),
        usdt: +s.usdt.toFixed(1),
        avg: +s.avg.toFixed(2),
        pf: Number.isFinite(s.pf) ? +s.pf.toFixed(2) : null,
      };
    });
}

function bySym(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!m.has(t.sym)) m.set(t.sym, []);
    m.get(t.sym).push(t);
  }
  return [...m.entries()]
    .map(([sym, list]) => {
      const s = summarize(sym, list);
      return { sym, n: s.n, usdt: +s.usdt.toFixed(1), wr: +(s.wr * 100).toFixed(1), avg: +s.avg.toFixed(2) };
    })
    .sort((a, b) => b.usdt - a.usdt);
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
    `rsi_1h_long · S1 completo | ${daysArg}d | ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}`
  );
  console.log(
    `Entrada: EMA${EMA_PERIOD} cross↑ + RSI azul < ${RSI_MA_MAX} + dist EMA${EMA_DAILY}d < ${MAX_DIST_EMA70}%`
  );
  console.log(
    `Saída: TP1 +${TP1_PCT}%@${TP1_POS * 100}% | TP2 +${TP2_PCT}%@${TP2_POS * 100}% | resto ${HOLD_H}h | SL −${SL_PCT}% | fee ${FEE}%`
  );

  const snaps = buildS1Snaps(d1BySym, t0, t1);
  const trades = collectTrades(h1BySym, d1BySym, snaps, t0, t1);
  const sum = summarize('live', trades);
  const months = byMonth(trades);
  const syms = bySym(trades);
  const top10 = syms.slice(0, 10);
  const worst10 = [...syms].sort((a, b) => a.usdt - b.usdt).slice(0, 10);
  const best5 = [...trades].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const worst5 = [...trades].sort((a, b) => a.pnl - b.pnl).slice(0, 5);

  const pf = Number.isFinite(sum.pf) ? sum.pf.toFixed(2) : '∞';
  console.log('\n' + '═'.repeat(72));
  console.log(
    `n=${sum.n}  WR=${(sum.wr * 100).toFixed(1)}%  avg=${sum.avg >= 0 ? '+' : ''}${sum.avg.toFixed(2)}%  USDT=${sum.usdt >= 0 ? '+' : ''}${sum.usdt.toFixed(1)}  PF=${pf}  MaxDD=${sum.maxDd.toFixed(1)}%  hold=${sum.avgHoldH.toFixed(1)}h`
  );
  console.log(
    `TP1 hit ${(sum.hit1Rate * 100).toFixed(0)}% | TP2 hit ${(sum.hit2Rate * 100).toFixed(0)}% | Máx+ ${sum.avgFav.toFixed(1)}% | Máx− ${sum.avgAdv.toFixed(1)}%`
  );
  console.log('paths', sum.byPath);
  console.log('═'.repeat(72));

  console.log('\nPor mês:');
  for (const m of months) {
    console.log(
      `  ${m.month}  n=${String(m.n).padStart(4)}  WR=${String(m.wr).padStart(5)}%  USDT=${(m.usdt >= 0 ? '+' : '') + m.usdt.toFixed(1).padStart(7)}  avg=${m.avg.toFixed(2)}%`
    );
  }

  console.log('\nTop 10 símbolos USDT:');
  for (const s of top10) {
    console.log(`  ${s.sym.padEnd(14)} n=${String(s.n).padStart(3)}  USDT=${(s.usdt >= 0 ? '+' : '') + s.usdt.toFixed(1)}  WR=${s.wr}%`);
  }
  console.log('\nPiores 10 símbolos USDT:');
  for (const s of worst10) {
    console.log(`  ${s.sym.padEnd(14)} n=${String(s.n).padStart(3)}  USDT=${(s.usdt >= 0 ? '+' : '') + s.usdt.toFixed(1)}  WR=${s.wr}%`);
  }

  const html = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"/>
<title>rsi_1h_long ${daysArg}d</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;background:#111;color:#eee}
h1{font-size:22px;margin:0 0 8px}p{color:#aaa;font-size:14px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.stat{background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:12px 16px}
.stat b{display:block;font-size:20px;margin-top:4px}.stat span{font-size:12px;color:#888}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{background:#222}.ok{color:#3dd68c}.bad{color:#f87171}
h2{font-size:16px;margin:28px 0 8px;color:#ccc}
</style></head><body>
<h1>rsi_1h_long — Scanner 1 completo</h1>
<p>${daysArg}d · EMA${EMA_PERIOD} cross↑ + RSI azul &lt; ${RSI_MA_MAX} + dist EMA${EMA_DAILY}d &lt; ${MAX_DIST_EMA70}% · TP +${TP1_PCT}%@${TP1_POS * 100}% +${TP2_PCT}%@${TP2_POS * 100}% · resto ${HOLD_H}h · SL −${SL_PCT}% · size ${SIZE} · ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)}</p>
<div class="stats">
  <div class="stat"><span>Trades</span><b>${sum.n}</b></div>
  <div class="stat"><span>Win rate</span><b>${(sum.wr * 100).toFixed(1)}%</b></div>
  <div class="stat"><span>USDT</span><b class="${sum.usdt >= 0 ? 'ok' : 'bad'}">${sum.usdt.toFixed(1)}</b></div>
  <div class="stat"><span>Avg %</span><b class="${sum.avg >= 0 ? 'ok' : 'bad'}">${sum.avg.toFixed(2)}</b></div>
  <div class="stat"><span>PF</span><b>${Number.isFinite(sum.pf) ? sum.pf.toFixed(2) : '∞'}</b></div>
  <div class="stat"><span>TP1 / TP2 hit</span><b>${(sum.hit1Rate * 100).toFixed(0)}% / ${(sum.hit2Rate * 100).toFixed(0)}%</b></div>
  <div class="stat"><span>Hold médio</span><b>${sum.avgHoldH.toFixed(1)}h</b></div>
</div>
<h2>Por path</h2>
<table><thead><tr><th>Path</th><th>n</th></tr></thead><tbody>
${Object.entries(sum.byPath)
  .map(([k, n]) => `<tr><td>${k}</td><td>${n}</td></tr>`)
  .join('\n')}
</tbody></table>
<h2>Por mês</h2>
<table><thead><tr><th>Mês</th><th>n</th><th>WR</th><th>USDT</th><th>avg%</th><th>PF</th></tr></thead><tbody>
${months
  .map(
    (m) =>
      `<tr><td>${m.month}</td><td>${m.n}</td><td>${m.wr}%</td><td class="${m.usdt >= 0 ? 'ok' : 'bad'}">${m.usdt}</td><td>${m.avg}</td><td>${m.pf ?? '∞'}</td></tr>`
  )
  .join('\n')}
</tbody></table>
</body></html>`;

  const out = {
    meta: {
      strategy: 'RSI_1H_LONG',
      display: 'rsi_1h_long',
      universe: 'Scanner 1 completo — EMA70 1d (sem top N)',
      days: daysArg,
      from: new Date(t0).toISOString(),
      to: new Date(t1).toISOString(),
      entry: `fecho 1h cruza EMA${EMA_PERIOD}↑ + RSI azul < ${RSI_MA_MAX} + dist EMA${EMA_DAILY} 1d < ${MAX_DIST_EMA70}%`,
      exit: `TP1 +${TP1_PCT}%@${TP1_POS * 100}% | TP2 +${TP2_PCT}%@${TP2_POS * 100}% | resto ${HOLD_H}h | SL −${SL_PCT}%`,
      feePct: FEE,
      sizeUsdt: SIZE,
      cache: path.basename(CACHE),
    },
    summary: {
      ...sum,
      wr: +(sum.wr * 100).toFixed(1),
      usdt: +sum.usdt.toFixed(1),
      avg: +sum.avg.toFixed(2),
      pf: Number.isFinite(sum.pf) ? +sum.pf.toFixed(2) : null,
      maxDd: +sum.maxDd.toFixed(1),
      avgHoldH: +sum.avgHoldH.toFixed(2),
      avgFav: +sum.avgFav.toFixed(2),
      avgAdv: +sum.avgAdv.toFixed(2),
      hit1Rate: +(sum.hit1Rate * 100).toFixed(1),
      hit2Rate: +(sum.hit2Rate * 100).toFixed(1),
    },
    months,
    topSymbols: top10,
    worstSymbols: worst10,
    best5,
    worst5,
    trades,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  writeFileSync(HTML, html);
  console.log(`\nEscrito ${path.basename(OUT)} | ${path.basename(HTML)}`);
}

main();
