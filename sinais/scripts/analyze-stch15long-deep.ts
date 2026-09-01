/**
 * Estudo profundo stch15long (Scanner 2 Top 2 · Stoch 15m LONG).
 * Uso: npx tsx scripts/analyze-stch15long-deep.ts --from=2026-07-01
 */
import { writeFileSync } from 'fs';
import { MA_CROSS_15M_TZ } from '../lib/maCross15mGuard';
import type { StrategySimulationSide } from '../lib/strategySimulationProfiles';
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
  status: string;
  status24h: string | null;
  generatedAt: string;
};

type Extra = {
  rank: number | null;
  k: number | null;
  d: number | null;
  kPrev: number | null;
  dPrev: number | null;
  kdGap: number | null;
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    from: get('--from', '2026-07-01'),
    to: get('--to', new Date().toISOString().slice(0, 10)),
    minStrength: Number(get('--minStrength', '0')) || 0,
    out: get('--out', 'scripts/out-stch15long-deep.json'),
  };
}

function isStch(name: string) {
  return /stch15long/i.test(name);
}

function hourPt(iso: string) {
  return +new Date(iso).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
}

function dayPt(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

function weekdayPt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
}

function parseExtra(raw: string | null): Extra {
  const empty: Extra = { rank: null, k: null, d: null, kPrev: null, dPrev: null, kdGap: null };
  if (!raw) return empty;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const n = (k: string) => {
      const v = Number(o[k]);
      return Number.isFinite(v) ? v : null;
    };
    const k = n('k');
    const d = n('d');
    return {
      rank: n('scannerRank'),
      k,
      d,
      kPrev: n('kPrev'),
      dPrev: n('dPrev'),
      kdGap: k != null && d != null ? k - d : null,
    };
  } catch {
    return empty;
  }
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
    all.push(
      ...(json.signals ?? []).filter((s) => s.result24h != null && isStch(s.strategyName))
    );
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  const seen = new Set<string>();
  return all.filter((s) => {
    const key = `${s.symbol}|${s.direction}|${s.generatedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function profile(slPct: number): StrategySimulationSide {
  return {
    stopLossPct: slPct,
    tp1Pct: 0,
    tp2Pct: 0,
    tp1PositionPct: 0,
    tp2PositionPct: 0,
    // 0 = perfil stch (fecho K×D): sim usa ~25% do move 24h + SL full (canónico Estatísticas)
    finalCloseHours: 0,
  };
}

/** Hold 24h com SL (pessimista se exit K×D for mais cedo). */
function profileHold24h(slPct: number): StrategySimulationSide {
  return {
    stopLossPct: slPct,
    tp1Pct: 0,
    tp2Pct: 0,
    tp1PositionPct: 0,
    tp2PositionPct: 0,
    finalCloseHours: 24,
  };
}

function signalWithSl(s: SignalRow, slPct: number): SignalRow {
  return { ...s, stopLoss: s.entryPrice * (1 - slPct / 100) };
}

function netCanon(s: SignalRow, slPct = 5): number {
  return simulateSignalNetResultPercent(signalWithSl(s, slPct), profile(slPct), FEE);
}

function netHold24(s: SignalRow, slPct = 5): number {
  return simulateSignalNetResultPercent(signalWithSl(s, slPct), profileHold24h(slPct), FEE);
}

function rawMove(s: SignalRow): number {
  return (s.result24h / s.entryPrice) * 100;
}

function slHit(s: SignalRow, slPct = 5): boolean {
  const sl = s.entryPrice * (1 - slPct / 100);
  return s.low24h != null && s.low24h <= sl;
}

function summarize(nets: number[]) {
  const wins = nets.filter((n) => n >= 0);
  const losses = nets.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = nets.reduce((a, n) => a + n, 0);
  return {
    n: nets.length,
    wins: wins.length,
    losses: losses.length,
    winRate: nets.length ? (wins.length / nets.length) * 100 : 0,
    totalNet: total,
    avgNet: nets.length ? total / nets.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
    avgWin: wins.length ? grossW / wins.length : 0,
    avgLoss: losses.length ? -grossL / losses.length : 0,
    maxWin: wins.length ? Math.max(...wins) : 0,
    maxLoss: losses.length ? Math.min(...losses) : 0,
  };
}

function avg(nums: (number | null | undefined)[]) {
  const v = nums.filter((n): n is number => n != null && Number.isFinite(n));
  return v.length ? v.reduce((a, n) => a + n, 0) / v.length : 0;
}

function groupBy<T extends string | number>(
  rows: SignalRow[],
  keyFn: (s: SignalRow) => T,
  netFn: (s: SignalRow) => number
) {
  const m = new Map<T, SignalRow[]>();
  for (const s of rows) {
    const k = keyFn(s);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(s);
  }
  return [...m.entries()]
    .map(([key, list]) => ({
      key,
      ...summarize(list.map(netFn)),
      slHitRate: (list.filter((s) => slHit(s)).length / list.length) * 100,
      avgK: avg(list.map((s) => parseExtra(s.extraInfo).k)),
      avgKdGap: avg(list.map((s) => parseExtra(s.extraInfo).kdGap)),
      avgMove: avg(list.map(rawMove)),
    }))
    .sort((a, b) => b.totalNet - a.totalNet);
}

function kBucket(k: number | null): string {
  if (k == null) return '?';
  if (k < 20) return 'K <20 (OS)';
  if (k < 40) return 'K 20–40';
  if (k < 60) return 'K 40–60';
  if (k < 80) return 'K 60–80';
  return 'K ≥80 (OB)';
}

function gapBucket(g: number | null): string {
  if (g == null) return '?';
  if (g < 2) return 'gap <2';
  if (g < 5) return 'gap 2–5';
  if (g < 10) return 'gap 5–10';
  return 'gap ≥10';
}

function moveBucket(m: number): string {
  if (m >= 10) return '≥+10%';
  if (m >= 3) return '+3–10%';
  if (m >= 0) return '0–3%';
  if (m >= -5) return '0–−5%';
  if (m >= -10) return '−5–−10%';
  return '<−10%';
}

async function main() {
  const { from, to, minStrength, out } = parseArgs();
  console.log(`stch15long deep study ${from} → ${to}\n`);

  const signals = await fetchAll(from, to, minStrength);
  if (!signals.length) {
    console.error('Sem sinais stch15long fechados.');
    process.exit(1);
  }

  const net = (s: SignalRow) => netCanon(s, 5);
  const sorted = [...signals].sort((a, b) => net(b) - net(a));
  const top = sorted.slice(0, Math.min(20, signals.length));
  const bottom = sorted.slice(-Math.min(20, signals.length));

  const slLevels = [3, 5, 7, 10].map((sl) => ({
    slPct: sl,
    canon: summarize(signals.map((s) => netCanon(s, sl))),
    hold24: summarize(signals.map((s) => netHold24(s, sl))),
    slHits: signals.filter((s) => slHit(s, sl)).length,
    slHitRate: (signals.filter((s) => slHit(s, sl)).length / signals.length) * 100,
  }));

  // Daily equity (canon SL5)
  const byDay = new Map<string, SignalRow[]>();
  for (const s of signals) {
    const d = dayPt(s.generatedAt);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }
  let cum = 0;
  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const s = summarize(rows.map(net));
      cum += s.totalNet;
      return {
        date,
        weekday: weekdayPt(rows[0]!.generatedAt),
        ...s,
        cum: +cum.toFixed(2),
        slHits: rows.filter((r) => slHit(r)).length,
      };
    });

  const payload = {
    source: API,
    strategy: 'stch15long',
    description:
      'Scanner 2 Top 2 · Stoch 15m (20/15/11) · K×D up → LONG SL −5% · K×D down → exit · só LONG · cron 5m',
    from,
    to,
    feePct: FEE,
    positionUsd: 100,
    signalCount: signals.length,
    methods: {
      canon:
        'simulateSignalNetResultPercent finalHours=0 → ~25% do move 24h + SL full (perfil Estatísticas)',
      hold24: 'Hold 24h com SL (pessimista vs exit K×D precoce)',
    },
    overall: {
      canon: summarize(signals.map((s) => netCanon(s, 5))),
      hold24: summarize(signals.map((s) => netHold24(s, 5))),
      raw24h: summarize(signals.map((s) => rawMove(s) - FEE)),
      slHitRate5: (signals.filter((s) => slHit(s, 5)).length / signals.length) * 100,
      avgK: avg(signals.map((s) => parseExtra(s.extraInfo).k)),
      avgD: avg(signals.map((s) => parseExtra(s.extraInfo).d)),
      avgKdGap: avg(signals.map((s) => parseExtra(s.extraInfo).kdGap)),
      avgStrength: avg(signals.map((s) => s.strength)),
    },
    slSweep: slLevels,
    byHour: groupBy(signals, (s) => hourPt(s.generatedAt), net),
    byWeekday: groupBy(signals, (s) => weekdayPt(s.generatedAt), net),
    byRank: groupBy(signals, (s) => parseExtra(s.extraInfo).rank ?? -1, net),
    byK: groupBy(signals, (s) => kBucket(parseExtra(s.extraInfo).k), net),
    byGap: groupBy(signals, (s) => gapBucket(parseExtra(s.extraInfo).kdGap), net),
    byMove: groupBy(signals, (s) => moveBucket(rawMove(s)), net),
    byWeekend: groupBy(
      signals,
      (s) => (['Sat', 'Sun'].includes(weekdayPt(s.generatedAt)) ? 'FDS' : 'Semana'),
      net
    ),
    daily,
    topTrades: top.map((s) => {
      const e = parseExtra(s.extraInfo);
      return {
        symbol: s.symbol,
        net: +net(s).toFixed(2),
        move24h: +rawMove(s).toFixed(2),
        k: e.k,
        d: e.d,
        gap: e.kdGap != null ? +e.kdGap.toFixed(2) : null,
        rank: e.rank,
        hour: hourPt(s.generatedAt),
        date: dayPt(s.generatedAt),
        slHit: slHit(s),
      };
    }),
    bottomTrades: bottom.map((s) => {
      const e = parseExtra(s.extraInfo);
      return {
        symbol: s.symbol,
        net: +net(s).toFixed(2),
        move24h: +rawMove(s).toFixed(2),
        k: e.k,
        d: e.d,
        gap: e.kdGap != null ? +e.kdGap.toFixed(2) : null,
        rank: e.rank,
        hour: hourPt(s.generatedAt),
        date: dayPt(s.generatedAt),
        slHit: slHit(s),
      };
    }),
    topVsBottom: {
      topAvgK: avg(top.map((s) => parseExtra(s.extraInfo).k)),
      bottomAvgK: avg(bottom.map((s) => parseExtra(s.extraInfo).k)),
      topAvgGap: avg(top.map((s) => parseExtra(s.extraInfo).kdGap)),
      bottomAvgGap: avg(bottom.map((s) => parseExtra(s.extraInfo).kdGap)),
      topAvgMove: avg(top.map(rawMove)),
      bottomAvgMove: avg(bottom.map(rawMove)),
      topSlHits: top.filter((s) => slHit(s)).length,
      bottomSlHits: bottom.filter((s) => slHit(s)).length,
    },
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');

  const o = payload.overall.canon;
  console.log(`Sinais: ${signals.length}`);
  console.log(
    `Canon SL5%: n=${o.n} WR=${o.winRate.toFixed(1)}% net=$${o.totalNet.toFixed(0)} PF=${o.profitFactor === Infinity ? '∞' : o.profitFactor.toFixed(2)} avg=${o.avgNet.toFixed(2)}%`
  );
  console.log(
    `Hold24 SL5%: net=$${payload.overall.hold24.totalNet.toFixed(0)} WR=${payload.overall.hold24.winRate.toFixed(1)}%`
  );
  console.log(`SL hit rate 5%: ${payload.overall.slHitRate5.toFixed(1)}%`);
  console.log(
    `Avg K=${payload.overall.avgK.toFixed(1)} D=${payload.overall.avgD.toFixed(1)} gap=${payload.overall.avgKdGap.toFixed(1)}`
  );

  console.log('\n=== SL sweep (canon) ===');
  for (const r of slLevels) {
    console.log(
      `SL ${r.slPct}%: net=$${r.canon.totalNet.toFixed(0)} WR=${r.canon.winRate.toFixed(1)}% PF=${r.canon.profitFactor === Infinity ? '∞' : r.canon.profitFactor.toFixed(2)} hits=${r.slHits} (${r.slHitRate.toFixed(0)}%)`
    );
  }

  console.log('\n=== Por K na entrada ===');
  for (const r of payload.byK) {
    console.log(
      `${String(r.key).padEnd(12)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=$${r.totalNet.toFixed(0).padStart(5)}`
    );
  }

  console.log('\n=== Por gap K−D ===');
  for (const r of payload.byGap) {
    console.log(
      `${String(r.key).padEnd(10)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=$${r.totalNet.toFixed(0).padStart(5)}`
    );
  }

  console.log('\n=== Por rank Scanner 2 ===');
  for (const r of payload.byRank) {
    console.log(
      `rank ${String(r.key).padStart(2)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=$${r.totalNet.toFixed(0).padStart(5)}`
    );
  }

  console.log('\n=== Melhores horas PT ===');
  for (const r of payload.byHour.slice(0, 6)) {
    console.log(
      `${String(r.key).padStart(2)}h n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=$${r.totalNet.toFixed(0).padStart(5)}`
    );
  }
  console.log('=== Piores horas PT ===');
  for (const r of [...payload.byHour].sort((a, b) => a.totalNet - b.totalNet).slice(0, 6)) {
    console.log(
      `${String(r.key).padStart(2)}h n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=$${r.totalNet.toFixed(0).padStart(5)}`
    );
  }

  console.log('\n=== Por dia da semana ===');
  for (const r of payload.byWeekday) {
    console.log(
      `${String(r.key).padEnd(5)} n=${String(r.n).padStart(3)} WR=${r.winRate.toFixed(0).padStart(3)}% net=$${r.totalNet.toFixed(0).padStart(5)}`
    );
  }

  console.log(`\nJSON: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
