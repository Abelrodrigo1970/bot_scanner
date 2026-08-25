/**
 * MA Cross 12×21 — padrões nos melhores vs piores trades.
 * Cruza spread MA, distância ao MA21, hora PT, direcção, movimento 24h.
 *
 * Uso: npx tsx scripts/analyze-ma-cross-12x21-patterns.ts --from=2026-08-15
 */
import { writeFileSync } from 'fs';
import { MA_CROSS_15M_TZ } from '../lib/maCross15mGuard';
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const API = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const FEE = 0.1;
const TZ = MA_CROSS_15M_TZ;

type SignalRow = {
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategyName: string;
  entryPrice: number;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  extraInfo: string | null;
  result24h: number;
  high24h: number | null;
  low24h: number | null;
  strength: number;
  generatedAt: string;
};

type ParsedExtra = {
  diffPct: number | null;
  distCloseMaSlowAbsPct: number | null;
  distCloseMa200AbsPct: number | null;
  entryDiffPct: number | null;
  entryMaxDiffPct: number | null;
  maSpread: number | null;
  crossover: string | null;
};

type Enriched = SignalRow & {
  netPct: number;
  hourPt: number;
  weekdayPt: string;
  isWeekend: boolean;
  move24hPct: number;
  alignedMove24hPct: number;
  range24hPct: number;
  extra: ParsedExtra;
  tp1Hit: boolean;
  slHit: boolean;
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    from: get('--from', '2026-08-15'),
    to: get('--to', new Date().toISOString().slice(0, 10)),
    minStrength: Number(get('--minStrength', '70')) || 70,
    topN: Number(get('--topN', '40')) || 40,
    out: get('--out', 'scripts/out-ma-cross-12x21-patterns.json'),
  };
}

function isMaCross21(name: string) {
  return /12×21|12x21/i.test(name);
}

function parseExtra(raw: string | null): ParsedExtra {
  const empty: ParsedExtra = {
    diffPct: null,
    distCloseMaSlowAbsPct: null,
    distCloseMa200AbsPct: null,
    entryDiffPct: null,
    entryMaxDiffPct: null,
    maSpread: null,
    crossover: null,
  };
  if (!raw) return empty;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const num = (k: string) => {
      const v = o[k];
      if (v == null || v === 'off') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const distCloseMaSlowAbsPct = num('distCloseMaSlowAbsPct');
    const distCloseMa200AbsPct = num('distCloseMa200AbsPct');
    const distMa = distCloseMaSlowAbsPct ?? distCloseMa200AbsPct;
    const ma30 = num('ma30');
    const maSlow = num('maSlow');
    let maSpread: number | null = null;
    if (ma30 != null && maSlow != null && maSlow > 0) {
      maSpread = ((ma30 - maSlow) / maSlow) * 100;
    }
    return {
      diffPct: num('diffPct'),
      distCloseMaSlowAbsPct: distMa,
      distCloseMa200AbsPct,
      entryDiffPct: num('entryDiffPct'),
      entryMaxDiffPct: num('entryMaxDiffPct'),
      maSpread,
      crossover: typeof o.crossover === 'string' ? o.crossover : null,
    };
  } catch {
    return empty;
  }
}

function hourPt(iso: string) {
  return +new Date(iso).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
}

function weekdayPt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
}

async function fetchAll(from: string, to: string, minStrength: number): Promise<SignalRow[]> {
  const all: SignalRow[] = [];
  let cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const sliceEnd = monthEnd < end ? monthEnd : end;
    const url = `${API}/api/signals?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${cursor.toISOString().slice(0, 10)}&dateTo=${sliceEnd.toISOString().slice(0, 10)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { signals?: SignalRow[] };
    all.push(...(json.signals ?? []).filter((s) => s.result24h != null && isMaCross21(s.strategyName)));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  const seen = new Set<string>();
  return all.filter((s) => {
    const k = `${s.symbol}|${s.direction}|${s.generatedAt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function netOf(s: SignalRow): number {
  const side = getSimulationSideForSignal(s.strategyName, s.direction);
  if (!side) return (s.result24h / s.entryPrice) * 100 - FEE;
  return simulateSignalNetResultPercent(s, side, FEE);
}

function enrich(s: SignalRow): Enriched {
  const extra = parseExtra(s.extraInfo);
  const entry = s.entryPrice;
  const sl = s.stopLoss ?? entry;
  const t1 = s.target1 ?? entry;
  const move24hPct = entry ? (s.result24h / entry) * 100 : 0;
  const alignedMove24hPct = s.direction === 'BUY' ? move24hPct : -move24hPct;
  const hi = s.high24h ?? entry;
  const lo = s.low24h ?? entry;
  const range24hPct = entry ? ((hi - lo) / entry) * 100 : 0;
  const slHit =
    s.direction === 'BUY'
      ? lo <= sl
      : s.high24h != null && s.high24h >= sl;
  const tp1Hit =
    s.direction === 'BUY'
      ? hi >= t1
      : lo <= t1;

  return {
    ...s,
    netPct: netOf(s),
    hourPt: hourPt(s.generatedAt),
    weekdayPt: weekdayPt(s.generatedAt),
    isWeekend: ['Sat', 'Sun'].includes(weekdayPt(s.generatedAt)),
    move24hPct,
    alignedMove24hPct,
    range24hPct,
    extra,
    tp1Hit,
    slHit,
  };
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, n) => a + n, 0) / nums.length;
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function bucketStats(rows: Enriched[]) {
  const nets = rows.map((r) => r.netPct);
  const wins = rows.filter((r) => r.netPct >= 0);
  return {
    n: rows.length,
    winRate: rows.length ? (wins.length / rows.length) * 100 : 0,
    totalNet: nets.reduce((a, n) => a + n, 0),
    avgNet: avg(nets),
    avgSpread: avg(rows.map((r) => r.extra.diffPct ?? 0).filter(Boolean)),
    medSpread: median(rows.map((r) => r.extra.diffPct ?? 0).filter((n) => n > 0)),
    avgDistMa: avg(rows.map((r) => r.extra.distCloseMaSlowAbsPct ?? 0).filter(Boolean)),
    avgMove24h: avg(rows.map((r) => r.move24hPct)),
    avgAlignedMove24h: avg(rows.map((r) => r.alignedMove24hPct)),
    avgRange24h: avg(rows.map((r) => r.range24hPct)),
    tp1HitRate: rows.length ? (rows.filter((r) => r.tp1Hit).length / rows.length) * 100 : 0,
    slHitRate: rows.length ? (rows.filter((r) => r.slHit).length / rows.length) * 100 : 0,
    buyPct: rows.length ? (rows.filter((r) => r.direction === 'BUY').length / rows.length) * 100 : 0,
    weekendPct: rows.length ? (rows.filter((r) => r.isWeekend).length / rows.length) * 100 : 0,
  };
}

function groupBy<T extends string | number>(rows: Enriched[], keyFn: (r: Enriched) => T) {
  const m = new Map<T, Enriched[]>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()]
    .map(([key, list]) => ({ key, ...bucketStats(list) }))
    .sort((a, b) => b.totalNet - a.totalNet);
}

function spreadBucket(diff: number | null): string {
  if (diff == null) return '?';
  if (diff < 0.75) return '0.6–0.75%';
  if (diff < 1.0) return '0.75–1.0%';
  if (diff < 1.25) return '1.0–1.25%';
  return '1.25–1.5%';
}

function distMaBucket(d: number | null): string {
  if (d == null) return '?';
  if (d < 2) return '<2%';
  if (d < 4) return '2–4%';
  if (d < 6) return '4–6%';
  return '>6%';
}

function alignedMoveBucket(m: number): string {
  if (m >= 15) return '≥+15% favor';
  if (m >= 5) return '+5–15% favor';
  if (m >= 0) return '0–5% favor';
  if (m >= -5) return '0–5% contra';
  if (m >= -15) return '-5–15% contra';
  return '<-15% contra';
}

async function main() {
  const { from, to, minStrength, topN, out } = parseArgs();
  console.log(`MA Cross 12×21 padrões ${from} → ${to}\n`);

  const raw = await fetchAll(from, to, minStrength);
  const all = raw.map(enrich).sort((a, b) => b.netPct - a.netPct);
  const winners = all.filter((r) => r.netPct >= 0);
  const losers = all.filter((r) => r.netPct < 0);
  const top = all.slice(0, topN);
  const bottom = all.slice(-topN);

  const patterns = {
    source: API,
    from,
    to,
    signalCount: all.length,
    overall: bucketStats(all),
    winners: bucketStats(winners),
    losers: bucketStats(losers),
    topN: bucketStats(top),
    bottomN: bucketStats(bottom),
    byHour: groupBy(all, (r) => r.hourPt),
    bySpread: groupBy(all, (r) => spreadBucket(r.extra.diffPct)),
    byDistMa: groupBy(all, (r) => distMaBucket(r.extra.distCloseMaSlowAbsPct)),
    byAlignedMove: groupBy(all, (r) => alignedMoveBucket(r.alignedMove24hPct)),
    byDirection: groupBy(all, (r) => r.direction),
    byWeekend: groupBy(all, (r) => (r.isWeekend ? 'FDS' : 'Semana')),
    topTrades: top.slice(0, 15).map((r) => ({
      symbol: r.symbol,
      dir: r.direction,
      net: +r.netPct.toFixed(2),
      spread: r.extra.diffPct,
      distMa: r.extra.distCloseMaSlowAbsPct,
      move24h: +r.move24hPct.toFixed(2),
      hour: r.hourPt,
      date: r.generatedAt.slice(0, 10),
      tp1: r.tp1Hit,
    })),
    bottomTrades: bottom.slice(0, 15).map((r) => ({
      symbol: r.symbol,
      dir: r.direction,
      net: +r.netPct.toFixed(2),
      spread: r.extra.diffPct,
      distMa: r.extra.distCloseMaSlowAbsPct,
      move24h: +r.move24hPct.toFixed(2),
      hour: r.hourPt,
      date: r.generatedAt.slice(0, 10),
      slHit: r.slHit,
    })),
    spreadCompare: {
      topAvg: avg(top.map((r) => r.extra.diffPct ?? 0).filter(Boolean)),
      bottomAvg: avg(bottom.map((r) => r.extra.diffPct ?? 0).filter(Boolean)),
      winnersAvg: avg(winners.map((r) => r.extra.diffPct ?? 0).filter(Boolean)),
      losersAvg: avg(losers.map((r) => r.extra.diffPct ?? 0).filter(Boolean)),
    },
    distMaCompare: {
      topAvg: avg(top.map((r) => r.extra.distCloseMaSlowAbsPct ?? 0).filter(Boolean)),
      bottomAvg: avg(bottom.map((r) => r.extra.distCloseMaSlowAbsPct ?? 0).filter(Boolean)),
      winnersAvg: avg(winners.map((r) => r.extra.distCloseMaSlowAbsPct ?? 0).filter(Boolean)),
      losersAvg: avg(losers.map((r) => r.extra.distCloseMaSlowAbsPct ?? 0).filter(Boolean)),
    },
    moveCompare: {
      topAvg: avg(top.map((r) => r.alignedMove24hPct)),
      bottomAvg: avg(bottom.map((r) => r.alignedMove24hPct)),
      winnersAvg: avg(winners.map((r) => r.alignedMove24hPct)),
      losersAvg: avg(losers.map((r) => r.alignedMove24hPct)),
    },
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(out, JSON.stringify(patterns, null, 2), 'utf8');

  console.log('=== TOP vs BOTTOM (', topN, 'trades) ===');
  console.log('Spread MA médio:  TOP', patterns.spreadCompare.topAvg.toFixed(3), '%  BOTTOM', patterns.spreadCompare.bottomAvg.toFixed(3), '%');
  console.log('Dist MA21 média: TOP', patterns.distMaCompare.topAvg.toFixed(2), '%  BOTTOM', patterns.distMaCompare.bottomAvg.toFixed(2), '%');
  console.log('Move 24h alinhado: TOP', patterns.moveCompare.topAvg.toFixed(2), '%  BOTTOM', patterns.moveCompare.bottomAvg.toFixed(2), '%');
  console.log('TP1 hit rate:     TOP', patterns.topN.tp1HitRate.toFixed(1), '%  BOTTOM', patterns.bottomN.tp1HitRate.toFixed(1), '%');
  console.log('SL hit rate:      TOP', patterns.topN.slHitRate.toFixed(1), '%  BOTTOM', patterns.bottomN.slHitRate.toFixed(1), '%');

  console.log('\n=== Por spread MA (|MA12-MA21|/MA21) ===');
  for (const r of patterns.bySpread) {
    console.log(`${String(r.key).padEnd(12)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=${r.totalNet.toFixed(0).padStart(5)} avgSp=${r.avgSpread.toFixed(2)}%`);
  }

  console.log('\n=== Por distância preço→MA21 ===');
  for (const r of patterns.byDistMa) {
    console.log(`${String(r.key).padEnd(8)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=${r.totalNet.toFixed(0).padStart(5)} avgDist=${r.avgDistMa.toFixed(2)}%`);
  }

  console.log('\n=== Por movimento 24h ALINHADO à direcção ===');
  for (const r of patterns.byAlignedMove) {
    console.log(`${String(r.key).padEnd(14)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=${r.totalNet.toFixed(0).padStart(5)} avg=${r.avgAlignedMove24h.toFixed(1)}%`);
  }

  console.log('\n=== Melhores horas PT (top 8) ===');
  for (const r of patterns.byHour.slice(0, 8)) {
    console.log(`${String(r.key).padStart(2)}h n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=${r.totalNet.toFixed(0).padStart(5)}`);
  }
  console.log('\n=== Piores horas PT (bottom 8) ===');
  for (const r of [...patterns.byHour].sort((a, b) => a.totalNet - b.totalNet).slice(0, 8)) {
    console.log(`${String(r.key).padStart(2)}h n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=${r.totalNet.toFixed(0).padStart(5)}`);
  }

  console.log('\n=== BUY vs SELL ===');
  for (const r of patterns.byDirection) {
    console.log(`${r.key} n=${r.n} WR=${r.winRate.toFixed(1)}% net=${r.totalNet.toFixed(1)} tp1=${r.tp1HitRate.toFixed(1)}% sl=${r.slHitRate.toFixed(1)}%`);
  }

  console.log(`\nJSON: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
