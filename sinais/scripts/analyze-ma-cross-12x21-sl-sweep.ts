/**
 * MA Cross 12×21 — compara SL 15% vs 10% vs 5% (simulação high24h/low24h).
 * Uso: npx tsx scripts/analyze-ma-cross-12x21-sl-sweep.ts --from=2026-08-15
 */
import { writeFileSync } from 'fs';
import { MA_CROSS_15M_TZ } from '../lib/maCross15mGuard';
import {
  type StrategySimulationSide,
  getSimulationSideForSignal,
} from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const API = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const FEE = 0.1;
const TZ = MA_CROSS_15M_TZ;
const SL_LEVELS = [15, 10, 5] as const;

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
    out: get('--out', 'scripts/out-ma-cross-12x21-sl-sweep.json'),
  };
}

function isMaCross21(name: string): boolean {
  return /12×21|12x21/i.test(name);
}

function dayPt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

async function fetchAll(from: string, to: string, minStrength: number): Promise<SignalRow[]> {
  const all: SignalRow[] = [];
  let cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const sliceEnd = monthEnd < end ? monthEnd : end;
    const dateFrom = cursor.toISOString().slice(0, 10);
    const dateTo = sliceEnd.toISOString().slice(0, 10);
    const url = `${API}/api/signals?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${dateFrom}`);
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

function profileWithSl(slPct: number): StrategySimulationSide {
  return {
    stopLossPct: slPct,
    tp1Pct: 44,
    tp2Pct: 0,
    tp1PositionPct: 60,
    tp2PositionPct: 0,
    finalCloseHours: 24,
  };
}

function signalWithSl(signal: SignalRow, slPct: number): SignalRow {
  const entry = signal.entryPrice;
  const stopLoss =
    signal.direction === 'BUY' ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
  return { ...signal, stopLoss };
}

function netOf(signal: SignalRow, slPct: number): number {
  const baseSide = getSimulationSideForSignal(signal.strategyName, signal.direction);
  if (!baseSide) return (signal.result24h / signal.entryPrice) * 100 - FEE;
  const side = profileWithSl(slPct);
  return simulateSignalNetResultPercent(signalWithSl(signal, slPct), side, FEE);
}

function summarize(values: number[]) {
  const wins = values.filter((n) => n >= 0);
  const losses = values.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = values.reduce((a, n) => a + n, 0);
  const slHits = losses.filter((n) => Math.abs(n + FEE + 15) < 0.15 || Math.abs(n + FEE + 10) < 0.15 || Math.abs(n + FEE + 5) < 0.15);
  return {
    n: values.length,
    wins: wins.length,
    losses: losses.length,
    winRate: values.length ? (wins.length / values.length) * 100 : 0,
    totalNetPct: total,
    totalNetUsd: total, // $100/trade → net% ≈ net USD
    avgNetPct: values.length ? total / values.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
    avgWin: wins.length ? grossW / wins.length : 0,
    avgLoss: losses.length ? -grossL / losses.length : 0,
    maxLoss: losses.length ? Math.min(...losses) : 0,
    slLikeLosses: slHits.length,
  };
}

function countSlHits(signals: SignalRow[], slPct: number): number {
  let hits = 0;
  for (const s of signals) {
    const entry = s.entryPrice;
    const sl =
      s.direction === 'BUY' ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
    if (s.direction === 'BUY' && s.low24h != null && s.low24h <= sl) hits++;
    if (s.direction === 'SELL' && s.high24h != null && s.high24h >= sl) hits++;
  }
  return hits;
}

function dailyBreakdown(signals: SignalRow[], slPct: number) {
  const byDay = new Map<string, number[]>();
  for (const s of signals) {
    const d = dayPt(s.generatedAt);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(netOf(s, slPct));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, nets]) => ({ date, ...summarize(nets) }));
}

async function main() {
  const { from, to, minStrength, out } = parseArgs();
  console.log(`MA Cross 12×21 SL sweep ${from} → ${to} (minStrength ${minStrength})\n`);

  const signals = await fetchAll(from, to, minStrength);
  if (!signals.length) {
    console.error('Sem sinais MA Cross 12×21 fechados no período.');
    process.exit(1);
  }

  const buys = signals.filter((s) => s.direction === 'BUY');
  const sells = signals.filter((s) => s.direction === 'SELL');

  const bySl = SL_LEVELS.map((sl) => {
    const nets = signals.map((s) => netOf(s, sl));
    const buyNets = buys.map((s) => netOf(s, sl));
    const sellNets = sells.map((s) => netOf(s, sl));
    return {
      slPct: sl,
      overall: summarize(nets),
      buy: summarize(buyNets),
      sell: summarize(sellNets),
      slHits: countSlHits(signals, sl),
      slHitRate: (countSlHits(signals, sl) / signals.length) * 100,
      daily: dailyBreakdown(signals, sl),
    };
  });

  const payload = {
    source: API,
    strategy: 'MA Cross 12×21 (15m) — Scanner 2 top 30',
    from,
    to,
    minStrength,
    feePct: FEE,
    positionUsd: 100,
    method:
      'simulateSignalNetResultPercent: TP1 ±44% (60% pos.), restante 24h capped at SL; SL variável 15/10/5%',
    signalCount: signals.length,
    buyCount: buys.length,
    sellCount: sells.length,
    slLevels: bySl,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Sinais: ${signals.length} (BUY ${buys.length}, SELL ${sells.length})\n`);
  console.log('SL%  |   n |  WR%  | Net USD |  PF  | SL hits | Avg/trade');
  console.log('-----|-----|-------|---------|------|---------|----------');
  for (const row of bySl) {
    const o = row.overall;
    console.log(
      `${String(row.slPct).padStart(3)}% | ${String(o.n).padStart(3)} | ${o.winRate.toFixed(1).padStart(5)} | ${o.totalNetUsd.toFixed(0).padStart(7)} | ${o.profitFactor === Infinity ? '  ∞' : o.profitFactor.toFixed(2).padStart(4)} | ${String(row.slHits).padStart(7)} | ${o.avgNetPct.toFixed(2).padStart(8)}%`
    );
  }

  console.log('\nPor direcção (SL 15% vs 10% vs 5%):');
  for (const dir of ['buy', 'sell'] as const) {
    console.log(`\n  ${dir.toUpperCase()}:`);
    for (const row of bySl) {
      const d = row[dir];
      console.log(
        `    SL ${row.slPct}%: n=${d.n} WR=${d.winRate.toFixed(1)}% net=${d.totalNetUsd.toFixed(1)} PF=${d.profitFactor === Infinity ? '∞' : d.profitFactor.toFixed(2)}`
      );
    }
  }

  console.log(`\nJSON: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
