/**
 * EMA70 1h S1 (live) · estudo de filtros para melhorar acerto
 * Base: Scanner 1 top 50 · LONG fecho cruza EMA70 1h · TP1 +25% @ 50% · resto fecho < EMA70 −3% · SL −5%
 *
 * 1) Features por trade (hora UTC, dia, BTC, volume, rank S1, distância) → WR/PnL por grupo
 * 2) Variantes com filtros aplicados na entrada (re-simulação completa)
 *
 *   node scripts/study-ema70-1h-s1-filters.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FEE = 0.1;
const SIZE = 100;
const EMA_PERIOD = 70;
const TOP_N = 50;
const SNAP_MS = 4 * 3600_000;
const DAYS = 90;
const SL = 5;
const TP1 = 25;
const TP1_POS = 0.5;
const EXIT_BUF = 3;
const VOL_LOOKBACK = 20;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, 'cache-strategies-universe-fit-90d-c100.json');
const OUT = path.join(DIR, `out-ema70-1h-s1-filters-${DAYS}d-top${TOP_N}.json`);

function iso(t) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

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

const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
const h1BySym = new Map(Object.entries(cached.h1BySym || {}));
const d1BySym = new Map(Object.entries(cached.d1BySym || {}));

let maxT = 0;
let minT = Infinity;
for (const bars of h1BySym.values()) {
  if (!bars.length) continue;
  minT = Math.min(minT, bars[0].t);
  maxT = Math.max(maxT, bars[bars.length - 1].t);
}
const t1 = maxT;
const t0 = Math.max(minT, t1 - DAYS * 86400_000);

/** Scanner 1 snaps com rank e distância (%) por símbolo. */
const ema70d = new Map();
for (const [sym, bars] of d1BySym) {
  ema70d.set(
    sym,
    emaSeries(
      bars.map((b) => b.c),
      EMA_PERIOD
    )
  );
}
const snaps = new Map();
for (let t = alignDown(t0, SNAP_MS); t <= t1; t += SNAP_MS) {
  const rows = [];
  for (const [sym, d1] of d1BySym) {
    const i = findIdxAtOrBefore(d1, t);
    if (i < 0) continue;
    const ema = ema70d.get(sym)?.[i];
    const c = d1[i].c;
    if (!(ema != null && ema > 0 && c > ema)) continue;
    rows.push({ sym, dist: ((c - ema) / ema) * 100 });
  }
  rows.sort((a, b) => b.dist - a.dist);
  const m = new Map();
  rows.slice(0, TOP_N).forEach((r, idx) => m.set(r.sym, { rank: idx + 1, dist: r.dist }));
  snaps.set(t, m);
}
function s1Info(t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const m = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return m ? m.get(sym) || null : null;
}

// BTC
const btc = h1BySym.get('BTCUSDT') || [];
const btcC = btc.map((b) => b.c);
const btcE70 = emaSeries(btcC, 70);
const btcE200 = emaSeries(btcC, 200);
const btcIdx = new Map(btc.map((b, i) => [b.t, i]));
const btcD = d1BySym.get('BTCUSDT') || [];
const btcDE70 = emaSeries(
  btcD.map((b) => b.c),
  70
);
const btcDE21 = emaSeries(
  btcD.map((b) => b.c),
  21
);

function btcFeatures(t) {
  const i = btcIdx.get(t);
  if (i == null) return null;
  const c = btc[i].c;
  const chg24 = i >= 24 ? ((c - btc[i - 24].c) / btc[i - 24].c) * 100 : null;
  const chg4 = i >= 4 ? ((c - btc[i - 4].c) / btc[i - 4].c) * 100 : null;
  // diária: última vela fechada antes do dia corrente
  const dayStart = Math.floor(t / 86400_000) * 86400_000;
  const di = findIdxAtOrBefore(btcD, dayStart - 1);
  return {
    above70h: btcE70[i] != null ? c > btcE70[i] : null,
    above200h: btcE200[i] != null ? c > btcE200[i] : null,
    chg24,
    chg4,
    above70d: di >= 0 && btcDE70[di] != null ? btcD[di].c > btcDE70[di] : null,
    above21d: di >= 0 && btcDE21[di] != null ? btcD[di].c > btcDE21[di] : null,
  };
}

const emaBySym = new Map();
for (const [sym, bars] of h1BySym) {
  emaBySym.set(
    sym,
    emaSeries(
      bars.map((b) => b.c),
      EMA_PERIOD
    )
  );
}

function walk(bars, ema, entryIdx, entry) {
  const slPx = entry * (1 - SL / 100);
  const tpPx = entry * (1 + TP1 / 100);
  let hitTp1 = false;
  let locked = 0;
  let pathName = 'OPEN';
  let exitIdx = bars.length - 1;
  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    const e = ema[i];
    const rem = hitTp1 ? 1 - TP1_POS : 1;
    if (b.l <= slPx) {
      locked += rem * -SL;
      pathName = hitTp1 ? 'TP1+SL' : 'SL';
      exitIdx = i;
      break;
    }
    if (!hitTp1 && b.h >= tpPx) {
      locked += TP1_POS * TP1;
      hitTp1 = true;
    }
    if (e != null && b.c < e * (1 - EXIT_BUF / 100)) {
      locked += (hitTp1 ? 1 - TP1_POS : 1) * ((b.c - entry) / entry) * 100;
      pathName = hitTp1 ? 'TP1+EMA' : 'EMA';
      exitIdx = i;
      break;
    }
  }
  if (pathName === 'OPEN') {
    locked += (hitTp1 ? 1 - TP1_POS : 1) * ((bars[exitIdx].c - entry) / entry) * 100;
    pathName = hitTp1 ? 'TP1+EOD' : 'EOD';
  }
  const pnlPct = locked - FEE * 2;
  return { path: pathName, hitTp1, usdt: +((pnlPct * SIZE) / 100).toFixed(2), exitIdx, hours: exitIdx - entryIdx };
}

/** @param {(f: any) => boolean} filter */
function run(filter) {
  const trades = [];
  for (const [sym, bars] of h1BySym) {
    if (!bars || bars.length < EMA_PERIOD + 30) continue;
    if (!d1BySym.has(sym)) continue;
    const ema = emaBySym.get(sym);
    let busyUntil = -1;
    for (let i = VOL_LOOKBACK + 1; i < bars.length; i++) {
      const b = bars[i];
      if (b.t < t0 || b.t > t1) continue;
      if (i <= busyUntil) continue;
      if (ema[i] == null || ema[i - 1] == null) continue;
      if (!(bars[i - 1].c <= ema[i - 1] && b.c > ema[i])) continue;
      const s1 = s1Info(b.t, sym);
      if (!s1) continue;

      let sumV = 0;
      for (let j = i - VOL_LOOKBACK; j < i; j++) sumV += bars[j].v;
      const avgV = sumV / VOL_LOOKBACK;
      const d = new Date(b.t);
      // vela 1h com open em b.t fecha em b.t+1h → hora de entrada = fecho
      const closeHourUtc = new Date(b.t + 3600_000).getUTCHours();
      const f = {
        hourUtc: closeHourUtc,
        dow: new Date(b.t + 3600_000).getUTCDay(),
        weekend: [0, 6].includes(new Date(b.t + 3600_000).getUTCDay()),
        volRatio: avgV > 0 ? b.v / avgV : null,
        bodyPct: ((b.c - b.o) / b.o) * 100,
        distEma1h: ((b.c - ema[i]) / ema[i]) * 100,
        slope24: ema[i - 24] != null ? ((ema[i] - ema[i - 24]) / ema[i - 24]) * 100 : null,
        s1Rank: s1.rank,
        s1Dist: s1.dist,
        btc: btcFeatures(b.t),
        month: d.toISOString().slice(0, 7),
      };
      if (filter && !filter(f)) continue;

      const res = walk(bars, ema, i, b.c);
      trades.push({ symbol: sym, entryAt: iso(b.t), entryTs: b.t, entry: b.c, f, ...res });
      busyUntil = res.exitIdx;
    }
  }
  return trades;
}

function summarize(trades) {
  const n = trades.length;
  if (!n) return { n: 0, wr: 0, usdt: 0, avg: 0, pf: 0, maxDd: 0, months: {} };
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  const wins = trades.filter((t) => t.usdt > 0).length;
  const usdt = trades.reduce((a, t) => a + t.usdt, 0);
  const gw = trades.filter((t) => t.usdt > 0).reduce((a, t) => a + t.usdt, 0);
  const gl = Math.abs(trades.filter((t) => t.usdt < 0).reduce((a, t) => a + t.usdt, 0));
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    eq += t.usdt;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
  }
  const months = {};
  for (const t of trades) months[t.f.month] = +((months[t.f.month] || 0) + t.usdt).toFixed(2);
  return {
    n,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : 99,
    maxDd: +maxDd.toFixed(2),
    months,
  };
}

function groupBy(trades, keyFn, order) {
  const by = new Map();
  for (const t of trades) {
    const k = keyFn(t.f);
    if (k == null) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }
  const keys = order ? order.filter((k) => by.has(k)) : [...by.keys()].sort();
  return keys.map((k) => ({ key: k, ...summarize(by.get(k)) }));
}

function bucket(v, edges, labels) {
  if (v == null || !Number.isFinite(v)) return null;
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i];
  return labels[labels.length - 1];
}

function printGroups(title, rows) {
  console.log(`\n── ${title}`);
  for (const r of rows) {
    console.log(
      `  ${String(r.key).padEnd(14)} n=${String(r.n).padStart(4)} WR=${String(r.wr).padStart(5)}% USDT=${String(r.usdt).padStart(8)} avg=${String(r.avg).padStart(6)} PF=${String(r.pf).padStart(5)}  ${Object.entries(r.months)
        .sort()
        .map(([m, u]) => `${m.slice(5)}:${u}`)
        .join(' ')}`
    );
  }
}

// ── 1) Base + features
const base = run(null);
const baseSum = summarize(base);
console.log(`Janela ${iso(t0)} → ${iso(t1)} · S1 top ${TOP_N} · base live`);
console.log(
  `BASE n=${baseSum.n} WR=${baseSum.wr}% USDT=${baseSum.usdt} PF=${baseSum.pf} DD=${baseSum.maxDd} avg=${baseSum.avg}`
);

const HOUR_BLOCKS = ['00-03', '04-07', '08-11', '12-15', '16-19', '20-23'];
const groups = {
  hourBlock: groupBy(base, (f) => HOUR_BLOCKS[Math.floor(f.hourUtc / 4)], HOUR_BLOCKS),
  hour: groupBy(base, (f) => String(f.hourUtc).padStart(2, '0')),
  dow: groupBy(base, (f) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][f.dow], ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']),
  btcAbove70h: groupBy(base, (f) => (f.btc?.above70h == null ? null : f.btc.above70h ? 'acima' : 'abaixo')),
  btcAbove200h: groupBy(base, (f) => (f.btc?.above200h == null ? null : f.btc.above200h ? 'acima' : 'abaixo')),
  btcAbove70d: groupBy(base, (f) => (f.btc?.above70d == null ? null : f.btc.above70d ? 'acima' : 'abaixo')),
  btcAbove21d: groupBy(base, (f) => (f.btc?.above21d == null ? null : f.btc.above21d ? 'acima' : 'abaixo')),
  btcChg24: groupBy(
    base,
    (f) => bucket(f.btc?.chg24, [-2, -0.5, 0.5, 2], ['<-2%', '-2..-0.5', '-0.5..0.5', '0.5..2', '>2%']),
    ['<-2%', '-2..-0.5', '-0.5..0.5', '0.5..2', '>2%']
  ),
  btcChg4: groupBy(
    base,
    (f) => bucket(f.btc?.chg4, [-1, -0.25, 0.25, 1], ['<-1%', '-1..-0.25', '±0.25', '0.25..1', '>1%']),
    ['<-1%', '-1..-0.25', '±0.25', '0.25..1', '>1%']
  ),
  volRatio: groupBy(
    base,
    (f) => bucket(f.volRatio, [0.8, 1.2, 2, 4], ['<0.8x', '0.8-1.2x', '1.2-2x', '2-4x', '>4x']),
    ['<0.8x', '0.8-1.2x', '1.2-2x', '2-4x', '>4x']
  ),
  bodyPct: groupBy(
    base,
    (f) => bucket(f.bodyPct, [0.5, 1, 2, 4], ['<0.5%', '0.5-1%', '1-2%', '2-4%', '>4%']),
    ['<0.5%', '0.5-1%', '1-2%', '2-4%', '>4%']
  ),
  distEma1h: groupBy(
    base,
    (f) => bucket(f.distEma1h, [0.3, 0.7, 1.5, 3], ['<0.3%', '0.3-0.7%', '0.7-1.5%', '1.5-3%', '>3%']),
    ['<0.3%', '0.3-0.7%', '0.7-1.5%', '1.5-3%', '>3%']
  ),
  s1Rank: groupBy(
    base,
    (f) => bucket(f.s1Rank, [11, 21, 31, 41], ['1-10', '11-20', '21-30', '31-40', '41-50']),
    ['1-10', '11-20', '21-30', '31-40', '41-50']
  ),
  s1Dist: groupBy(
    base,
    (f) => bucket(f.s1Dist, [10, 20, 40, 80], ['<10%', '10-20%', '20-40%', '40-80%', '>80%']),
    ['<10%', '10-20%', '20-40%', '40-80%', '>80%']
  ),
  slope24: groupBy(
    base,
    (f) => bucket(f.slope24, [-1, 0, 1], ['<-1%', '-1..0', '0..1', '>1%']),
    ['<-1%', '-1..0', '0..1', '>1%']
  ),
};

if (!process.argv.includes('--variants-only')) {
  for (const [k, rows] of Object.entries(groups)) printGroups(k, rows);
}

// ── 2) Variantes (re-simulação com filtro na entrada)
const VARIANTS = [
  { key: 'base', label: 'Base live', filter: null },
  { key: 'btc70h', label: 'BTC > EMA70 1h', filter: (f) => f.btc?.above70h === true },
  { key: 'btc200h', label: 'BTC > EMA200 1h', filter: (f) => f.btc?.above200h === true },
  { key: 'btc70d', label: 'BTC > EMA70 1d', filter: (f) => f.btc?.above70d === true },
  { key: 'btc21d', label: 'BTC > EMA21 1d', filter: (f) => f.btc?.above21d === true },
  { key: 'btc24pos', label: 'BTC 24h > 0%', filter: (f) => (f.btc?.chg24 ?? -1) > 0 },
  { key: 'btc24gtm1', label: 'BTC 24h > −1%', filter: (f) => (f.btc?.chg24 ?? -9) > -1 },
  { key: 'btc4gtm05', label: 'BTC 4h > −0.5%', filter: (f) => (f.btc?.chg4 ?? -9) > -0.5 },
  { key: 'noWeekend', label: 'Sem fim de semana', filter: (f) => !f.weekend },
  { key: 'h08_23', label: 'Só 08–23h UTC', filter: (f) => f.hourUtc >= 8 },
  { key: 'h12_23', label: 'Só 12–23h UTC', filter: (f) => f.hourUtc >= 12 },
  { key: 'no00_07', label: 'Sem 00–07h UTC', filter: (f) => f.hourUtc >= 8 || f.hourUtc < 0 },
  { key: 'vol12', label: 'Volume ≥ 1.2× MA20', filter: (f) => (f.volRatio ?? 0) >= 1.2 },
  { key: 'vol2', label: 'Volume ≥ 2× MA20', filter: (f) => (f.volRatio ?? 0) >= 2 },
  { key: 'body1', label: 'Corpo vela ≥ 1%', filter: (f) => f.bodyPct >= 1 },
  { key: 'rank1_30', label: 'S1 rank 1–30', filter: (f) => f.s1Rank <= 30 },
  { key: 'dist_lt40', label: 'Dist EMA70 1d < 40%', filter: (f) => f.s1Dist < 40 },
  { key: 'no08_11', label: 'Sem 08–11h UTC', filter: (f) => f.hourUtc < 8 || f.hourUtc > 11 },
  { key: 'body_lt4', label: 'Corpo vela < 4%', filter: (f) => f.bodyPct < 4 },
  { key: 'body_lt2', label: 'Corpo vela < 2%', filter: (f) => f.bodyPct < 2 },
  { key: 'd1h_lt15', label: 'Fecho < EMA1h +1.5%', filter: (f) => f.distEma1h < 1.5 },
  { key: 'btc4_lt1', label: 'BTC 4h < +1%', filter: (f) => (f.btc?.chg4 ?? 0) < 1 },
  { key: 'btc24_lt2', label: 'BTC 24h < +2%', filter: (f) => (f.btc?.chg24 ?? 0) < 2 },
  { key: 'vol_lt4', label: 'Volume < 4× MA20', filter: (f) => (f.volRatio ?? 0) < 4 },
  {
    key: 'combo_a',
    label: 'Corpo<4% + BTC4h<1%',
    filter: (f) => f.bodyPct < 4 && (f.btc?.chg4 ?? 0) < 1,
  },
  {
    key: 'combo_b',
    label: 'Corpo<4% + dist1d<40%',
    filter: (f) => f.bodyPct < 4 && f.s1Dist < 40,
  },
  {
    key: 'combo_c',
    label: 'Corpo<4% + dist1d<40% + BTC4h<1%',
    filter: (f) => f.bodyPct < 4 && f.s1Dist < 40 && (f.btc?.chg4 ?? 0) < 1,
  },
  {
    key: 'combo_d',
    label: 'C + sem 08–11h',
    filter: (f) =>
      f.bodyPct < 4 && f.s1Dist < 40 && (f.btc?.chg4 ?? 0) < 1 && (f.hourUtc < 8 || f.hourUtc > 11),
  },
  {
    key: 'combo_e',
    label: 'Corpo<2% + dist1d<40%',
    filter: (f) => f.bodyPct < 2 && f.s1Dist < 40,
  },
  {
    key: 'combo_f',
    label: 'C + BTC > EMA21 1d',
    filter: (f) => f.bodyPct < 4 && f.s1Dist < 40 && (f.btc?.chg4 ?? 0) < 1 && f.btc?.above21d === true,
  },
];

console.log('\n' + '═'.repeat(110));
console.log('Variantes (re-simulação)');
const variantResults = [];
for (const v of VARIANTS) {
  const s = summarize(run(v.filter));
  variantResults.push({ key: v.key, label: v.label, summary: s });
  console.log(
    `${v.label.padEnd(26)} n=${String(s.n).padStart(4)} WR=${String(s.wr).padStart(5)}% USDT=${String(s.usdt).padStart(8)} PF=${String(s.pf).padStart(5)} DD=${String(s.maxDd).padStart(7)} avg=${String(s.avg).padStart(5)}  ${Object.entries(s.months)
      .sort()
      .map(([m, u]) => `${m.slice(5)}:${u}`)
      .join(' ')}`
  );
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: { from: iso(t0), to: iso(t1), topN: TOP_N, sl: SL, tp1: TP1, tp1Pos: TP1_POS, exitBuf: EXIT_BUF },
      base: baseSum,
      groups,
      variants: variantResults,
    },
    null,
    2
  )
);
console.log(`\n→ ${OUT}`);
