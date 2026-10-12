/**
 * EMA70 1h · Scanner 1 top 50 · variantes para reduzir whipsaw
 * Base: cruzamento EMA70 1h, SL 5%, TP1 25% @ 50%, resto no flip EMA70.
 *
 *   node scripts/study-ema70-1h-s1-variants.mjs
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

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, 'cache-strategies-universe-fit-90d-c100.json');
const OUT = path.join(DIR, `out-ema70-1h-s1-variants-${DAYS}d-top${TOP_N}.json`);

const BASE = {
  sides: ['LONG', 'SHORT'],
  sl: 5,
  tp1: 25,
  tp1Pos: 0.5,
  entryBuf: 0,
  exitBuf: 0,
  slopeBars: 0,
  btcAboveEma: false,
  confirmBars: 1,
};

const VARIANTS = [
  { key: 'base', label: 'Base (LONG+SHORT)', cfg: {} },
  { key: 'long', label: 'Só LONG', cfg: { sides: ['LONG'] } },
  { key: 'long_in1', label: 'LONG · entrada fecho > EMA +1%', cfg: { sides: ['LONG'], entryBuf: 1 } },
  { key: 'long_out1', label: 'LONG · saída fecho < EMA −1%', cfg: { sides: ['LONG'], exitBuf: 1 } },
  { key: 'long_out2', label: 'LONG · saída fecho < EMA −2%', cfg: { sides: ['LONG'], exitBuf: 2 } },
  { key: 'long_conf2', label: 'LONG · 2 fechos acima EMA', cfg: { sides: ['LONG'], confirmBars: 2 } },
  { key: 'long_slope', label: 'LONG · EMA70 a subir (24h)', cfg: { sides: ['LONG'], slopeBars: 24 } },
  { key: 'long_btc', label: 'LONG · BTC acima EMA70 1h', cfg: { sides: ['LONG'], btcAboveEma: true } },
  {
    key: 'long_slope_out1',
    label: 'LONG · EMA a subir + saída −1%',
    cfg: { sides: ['LONG'], slopeBars: 24, exitBuf: 1 },
  },
  {
    key: 'long_slope_out1_btc',
    label: 'LONG · EMA a subir + saída −1% + BTC',
    cfg: { sides: ['LONG'], slopeBars: 24, exitBuf: 1, btcAboveEma: true },
  },
  { key: 'long_out3', label: 'LONG · saída fecho < EMA −3%', cfg: { sides: ['LONG'], exitBuf: 3 } },
  { key: 'long_out4', label: 'LONG · saída fecho < EMA −4%', cfg: { sides: ['LONG'], exitBuf: 4 } },
  {
    key: 'long_out2_conf2',
    label: 'LONG · 2 fechos acima + saída −2%',
    cfg: { sides: ['LONG'], confirmBars: 2, exitBuf: 2 },
  },
  {
    key: 'long_out1_sl8',
    label: 'LONG · saída −1% · SL 8%',
    cfg: { sides: ['LONG'], exitBuf: 1, sl: 8 },
  },
];

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

function buildS1Snaps(d1BySym, startMs, endMs) {
  const snaps = new Map();
  const ema70 = new Map();
  for (const [sym, bars] of d1BySym) {
    ema70.set(
      sym,
      emaSeries(
        bars.map((b) => b.c),
        EMA_PERIOD
      )
    );
  }
  for (let t = alignDown(startMs, SNAP_MS); t <= endMs; t += SNAP_MS) {
    const rows = [];
    for (const [sym, d1] of d1BySym) {
      const i = findIdxAtOrBefore(d1, t);
      if (i < 0) continue;
      const ema = ema70.get(sym)?.[i];
      const c = d1[i].c;
      if (!(ema != null && ema > 0 && c > ema)) continue;
      rows.push({ sym, abs: Math.abs(((c - ema) / ema) * 100) });
    }
    rows.sort((a, b) => b.abs - a.abs);
    snaps.set(t, new Set(rows.slice(0, TOP_N).map((r) => r.sym)));
  }
  return snaps;
}

function inS1(snaps, t, sym) {
  const snapT = alignDown(t, SNAP_MS);
  const set = snaps.get(snapT) || snaps.get(snapT - SNAP_MS);
  return set ? set.has(sym) : false;
}

function aboveBy(c, e, buf) {
  return c > e * (1 + buf / 100);
}

function belowBy(c, e, buf) {
  return c < e * (1 - buf / 100);
}

function walk(bars, ema, entryIdx, entry, side, cfg) {
  const isLong = side === 'LONG';
  const slPx = isLong ? entry * (1 - cfg.sl / 100) : entry * (1 + cfg.sl / 100);
  const tpPx = isLong ? entry * (1 + cfg.tp1 / 100) : entry * (1 - cfg.tp1 / 100);
  const ret = (px) => (isLong ? ((px - entry) / entry) * 100 : ((entry - px) / entry) * 100);

  let hitTp1 = false;
  let locked = 0;
  let pathName = 'OPEN';
  let exitIdx = bars.length - 1;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    const e = ema[i];
    const hitSl = isLong ? b.l <= slPx : b.h >= slPx;
    const hitTp = !hitTp1 && (isLong ? b.h >= tpPx : b.l <= tpPx);
    const exitSignal = e != null && (isLong ? belowBy(b.c, e, cfg.exitBuf) : aboveBy(b.c, e, cfg.exitBuf));
    const rem = hitTp1 ? 1 - cfg.tp1Pos : 1;

    if (hitSl) {
      locked += rem * -cfg.sl;
      pathName = hitTp1 ? 'TP1+SL' : 'SL';
      exitIdx = i;
      break;
    }
    if (hitTp) {
      locked += cfg.tp1Pos * cfg.tp1;
      hitTp1 = true;
    }
    if (exitSignal) {
      locked += (hitTp1 ? 1 - cfg.tp1Pos : 1) * ret(b.c);
      pathName = hitTp1 ? 'TP1+EMA' : 'EMA';
      exitIdx = i;
      break;
    }
  }

  if (pathName === 'OPEN') {
    locked += (hitTp1 ? 1 - cfg.tp1Pos : 1) * ret(bars[exitIdx].c);
    pathName = hitTp1 ? 'TP1+EOD' : 'EOD';
  }

  const pnlPct = locked - FEE * 2;
  return {
    path: pathName,
    hitTp1,
    pnlPct: +pnlPct.toFixed(4),
    usdt: +((pnlPct * SIZE) / 100).toFixed(2),
    exitIdx,
    hours: exitIdx - entryIdx,
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) return { n: 0, wr: 0, usdt: 0, avg: 0, pf: 0, maxDd: 0, medHours: 0, paths: {} };
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
  const paths = {};
  for (const t of trades) paths[t.path] = (paths[t.path] || 0) + 1;
  const hours = trades.map((t) => t.hours).sort((a, b) => a - b);
  return {
    n,
    wr: +((100 * wins) / n).toFixed(1),
    usdt: +usdt.toFixed(2),
    avg: +(usdt / n).toFixed(2),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : 99,
    maxDd: +maxDd.toFixed(2),
    medHours: hours[Math.floor(n / 2)],
    paths,
  };
}

function monthly(trades) {
  const by = {};
  for (const t of trades) {
    const m = t.entryAt.slice(0, 7);
    by[m] = (by[m] || 0) + t.usdt;
  }
  return Object.entries(by)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, usdt]) => ({ month, usdt: +usdt.toFixed(2) }));
}

if (!existsSync(CACHE)) {
  console.error(`Cache em falta: ${CACHE}`);
  process.exit(1);
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
const snaps = buildS1Snaps(d1BySym, t0, t1);

const btcBars = h1BySym.get('BTCUSDT') || [];
const btcEma = emaSeries(
  btcBars.map((b) => b.c),
  EMA_PERIOD
);
const btcIdxByT = new Map(btcBars.map((b, i) => [b.t, i]));
function btcAbove(t) {
  const i = btcIdxByT.get(t);
  if (i == null || btcEma[i] == null) return false;
  return btcBars[i].c > btcEma[i];
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

function run(cfg) {
  const trades = [];
  for (const [sym, bars] of h1BySym) {
    if (!bars || bars.length < EMA_PERIOD + 30) continue;
    if (!d1BySym.has(sym)) continue;
    const ema = emaBySym.get(sym);
    let busyUntil = -1;
    const k = cfg.confirmBars;

    for (let i = k; i < bars.length; i++) {
      if (bars[i].t < t0 || bars[i].t > t1) continue;
      if (i <= busyUntil) continue;
      if (ema[i] == null || ema[i - k] == null) continue;
      if (!inS1(snaps, bars[i].t, sym)) continue;

      // cruzamento: barra i-k do lado oposto, barras i-k+1..i todas do lado novo
      let longSig = cfg.sides.includes('LONG') && bars[i - k].c <= ema[i - k];
      let shortSig = cfg.sides.includes('SHORT') && bars[i - k].c >= ema[i - k];
      for (let j = i - k + 1; j <= i; j++) {
        if (!aboveBy(bars[j].c, ema[j], cfg.entryBuf)) longSig = false;
        if (!belowBy(bars[j].c, ema[j], cfg.entryBuf)) shortSig = false;
      }
      if (cfg.slopeBars > 0) {
        const prevE = ema[i - cfg.slopeBars];
        if (prevE == null) continue;
        if (!(ema[i] > prevE)) longSig = false;
        if (!(ema[i] < prevE)) shortSig = false;
      }
      if (cfg.btcAboveEma) {
        if (!btcAbove(bars[i].t)) longSig = false;
        else shortSig = false;
      }
      if (!longSig && !shortSig) continue;

      const side = longSig ? 'LONG' : 'SHORT';
      const res = walk(bars, ema, i, bars[i].c, side, cfg);
      trades.push({ symbol: sym, side, entryAt: iso(bars[i].t), entryTs: bars[i].t, entry: bars[i].c, ...res });
      busyUntil = res.exitIdx;
    }
  }
  return trades;
}

console.log(`Janela ${iso(t0)} → ${iso(t1)} · S1 top ${TOP_N}`);
console.log('═'.repeat(100));

const results = [];
for (const v of VARIANTS) {
  const cfg = { ...BASE, ...v.cfg };
  const trades = run(cfg);
  const s = summarize(trades);
  const m = monthly(trades);
  const bySym = {};
  for (const t of trades) bySym[t.symbol] = (bySym[t.symbol] || 0) + t.usdt;
  const symRank = Object.entries(bySym)
    .map(([symbol, usdt]) => ({ symbol, usdt: +usdt.toFixed(2) }))
    .sort((a, b) => b.usdt - a.usdt);
  const top3 = symRank.slice(0, 3);
  const exTop3 = +(s.usdt - top3.reduce((a, x) => a + x.usdt, 0)).toFixed(2);
  const symPositive = symRank.filter((x) => x.usdt > 0).length;
  results.push({ key: v.key, label: v.label, cfg, summary: s, monthly: m, top3, exTop3, symPositive, symCount: symRank.length });
  console.log(
    `${v.label.padEnd(42)} n=${String(s.n).padStart(5)} WR=${String(s.wr).padStart(5)}% USDT=${String(s.usdt).padStart(8)} PF=${String(s.pf).padStart(5)} DD=${String(s.maxDd).padStart(7)} avg=${String(s.avg).padStart(5)} medH=${String(s.medHours).padStart(3)} exTop3=${String(exTop3).padStart(8)} sym+=${symPositive}/${symRank.length}  ${m.map((x) => `${x.month.slice(5)}:${x.usdt}`).join(' ')}`
  );
}

writeFileSync(
  OUT,
  JSON.stringify(
    { meta: { from: iso(t0), to: iso(t1), topN: TOP_N, cache: path.basename(CACHE) }, results },
    null,
    2
  )
);
console.log(`\n→ ${OUT}`);
