/**
 * MA Cross 15m + Pivot Boss Bear 15m — lucro vs volume/liquidez (turnover 1h USDT).
 * Usa volume da vela 1h Binance no momento do sinal como proxy de market cap/liquidez.
 *
 * Uso: npx tsx scripts/analyze-strategies-marketcap.ts
 *      npx tsx scripts/analyze-strategies-marketcap.ts --from=2026-04-01 --minStrength=70
 */

import {
  MA_CROSS_15M_MIN_TURNOVER_1H_USD,
  MA_CROSS_15M_TZ,
} from '../lib/maCross15mGuard';
import {
  PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD,
} from '../lib/pivotBossGuard';
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const FEE = 0.1;
const API = 'https://botcripto-production.up.railway.app/api/signals';
const TZ = MA_CROSS_15M_TZ;
const BINANCE = 'https://fapi.binance.com';

type SignalRow = {
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategyName: string;
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  extraInfo: string | null;
  result24h: number;
  high24h: number | null;
  low24h: number | null;
  strength: number;
  generatedAt: string;
};

type Enriched = SignalRow & {
  turnover1hUsd: number;
  isWin: boolean;
  netPct: number;
};

type BucketDef = { label: string; min: number; max: number | null };

const TURNOVER_BUCKETS: BucketDef[] = [
  { label: '< $1M', min: 0, max: 1_000_000 },
  { label: '$1M – $5M', min: 1_000_000, max: 5_000_000 },
  { label: '$5M – $20M', min: 5_000_000, max: 20_000_000 },
  { label: '$20M – $50M', min: 20_000_000, max: 50_000_000 },
  { label: '$50M – $100M', min: 50_000_000, max: 100_000_000 },
  { label: '≥ $100M', min: 100_000_000, max: null },
];

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    from: get('--from', '2026-01-01'),
    to: get('--to', '2026-12-31'),
    minStrength: Number(get('--minStrength', '70')) || 70,
    weekdaysOnly: !a.includes('--include-weekends'),
  };
}

function isWeekend(iso: string): boolean {
  const d = new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  return d === 'Sat' || d === 'Sun';
}

function netMaCross(s: SignalRow): number {
  const side = getSimulationSideForSignal(s.strategyName, s.direction);
  if (!side) return (s.result24h / s.entryPrice) * 100 - FEE;
  return simulateSignalNetResultPercent(s, side, FEE);
}

function netPivotSl8(s: SignalRow): number {
  const sl = 8;
  const tp1 = 9;
  const tp1W = 0.5;
  const entry = s.entryPrice;
  const base24 = (s.result24h / entry) * 100;
  const slPx = entry * (1 + sl / 100);
  const tp1Px = entry * (1 - tp1 / 100);
  if (s.high24h != null && s.high24h >= slPx) return -sl - FEE;
  if (s.low24h != null && s.low24h <= tp1Px) {
    return tp1W * tp1 + (1 - tp1W) * Math.max(base24, -sl) - FEE;
  }
  return Math.max(base24, -sl) - FEE;
}

function stats(values: number[]) {
  if (!values.length) return null;
  const wins = values.filter((n) => n >= 0);
  const losses = values.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = values.reduce((a, n) => a + n, 0);
  return {
    n: values.length,
    wr: (wins.length / values.length) * 100,
    total,
    avg: total / values.length,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
  };
}

function bucketFor(turnover: number): BucketDef {
  for (const b of TURNOVER_BUCKETS) {
    if (turnover >= b.min && (b.max == null || turnover < b.max)) return b;
  }
  return TURNOVER_BUCKETS[0]!;
}

async function fetchSignals(from: string, to: string, minStrength: number): Promise<SignalRow[]> {
  const url = `${API}?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const json = (await res.json()) as { signals?: SignalRow[] };
  return (json.signals ?? []).filter((s) => s.result24h != null);
}

type KlineRow = [number, string, string, string, string, string, number, string, ...string[]];

async function fetch1hKlines(symbol: string, startMs: number, endMs: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  let cursor = startMs - 3_600_000;
  const step = 1000 * 3_600_000;

  while (cursor < endMs + 3_600_000) {
    const url = `${BINANCE}/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=1000&startTime=${cursor}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const rows = (await res.json()) as KlineRow[];
    if (!rows.length) break;

    for (const k of rows) {
      const ts = k[0];
      const quoteVol = parseFloat(k[7] ?? '0');
      if (Number.isFinite(quoteVol) && quoteVol > 0) out.set(ts, quoteVol);
    }

    const lastTs = rows[rows.length - 1]![0];
    if (lastTs <= cursor) break;
    cursor = lastTs + 3_600_000;
    await new Promise((r) => setTimeout(r, 120));
  }

  return out;
}

function turnoverAtSignal(klines: Map<number, number>, generatedAt: string): number | null {
  const ts = new Date(generatedAt).getTime();
  let best: number | null = null;
  let bestDist = Infinity;
  for (const [openTs, vol] of klines) {
    if (ts >= openTs && ts < openTs + 3_600_000) return vol;
    const dist = Math.abs(ts - openTs);
    if (dist < bestDist) {
      bestDist = dist;
      best = vol;
    }
  }
  return bestDist <= 90 * 60 * 1000 ? best : null;
}

async function enrichWithTurnover(
  signals: SignalRow[],
  netFn: (s: SignalRow) => number
): Promise<Enriched[]> {
  const bySymbol = new Map<string, SignalRow[]>();
  for (const s of signals) {
    if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, []);
    bySymbol.get(s.symbol)!.push(s);
  }

  const enriched: Enriched[] = [];
  let i = 0;
  const total = bySymbol.size;

  for (const [symbol, list] of bySymbol) {
    i++;
    if (i % 10 === 0) console.log(`  Klines ${i}/${total} (${symbol})…`);
    const times = list.map((s) => new Date(s.generatedAt).getTime());
    const startMs = Math.min(...times);
    const endMs = Math.max(...times);
    const klines = await fetch1hKlines(symbol, startMs, endMs);

    for (const s of list) {
      const turnover1hUsd = turnoverAtSignal(klines, s.generatedAt);
      if (turnover1hUsd == null) continue;
      const netPct = netFn(s);
      enriched.push({
        ...s,
        turnover1hUsd,
        netPct,
        isWin: netPct >= 0,
      });
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  return enriched;
}

function printBucketTable(title: string, rows: Enriched[]) {
  console.log(`\n### ${title} — por turnover 1h (USDT) ###`);
  console.log('Bucket turnover | n  | WR   | PnL $ | PF   | Avg turnover');
  console.log('-'.repeat(72));

  for (const b of TURNOVER_BUCKETS) {
    const subset = rows.filter((r) => bucketFor(r.turnover1hUsd).label === b.label);
    if (!subset.length) continue;
    const st = stats(subset.map((r) => r.netPct))!;
    const avgTurn = subset.reduce((a, r) => a + r.turnover1hUsd, 0) / subset.length;
    console.log(
      `${b.label.padEnd(16)} | ${String(st.n).padStart(3)} | ${st.wr.toFixed(0).padStart(3)}% | ${st.total.toFixed(0).padStart(5)} | ${st.pf === Infinity ? '∞' : st.pf.toFixed(2).padStart(4)} | $${(avgTurn / 1e6).toFixed(1)}M`
    );
  }
}

function printWinnersVsLosers(title: string, rows: Enriched[]) {
  const wins = rows.filter((r) => r.isWin);
  const losses = rows.filter((r) => !r.isWin);
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.turnover1hUsd, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, r) => a + r.turnover1hUsd, 0) / losses.length : 0;
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  console.log(`\n### ${title} — vencedores vs perdedores ###`);
  console.log(`Vencedores: n=${wins.length} | turnover médio $${(avgWin / 1e6).toFixed(2)}M | mediana $${(med(wins.map((r) => r.turnover1hUsd)) / 1e6).toFixed(2)}M`);
  console.log(`Perdedores: n=${losses.length} | turnover médio $${(avgLoss / 1e6).toFixed(2)}M | mediana $${(med(losses.map((r) => r.turnover1hUsd)) / 1e6).toFixed(2)}M`);
  if (wins.length && losses.length) {
    const ratio = avgWin / avgLoss;
    console.log(`Razão turnover (win/loss): ${ratio.toFixed(2)}× ${ratio > 1 ? '(vencedores em pares mais líquidos)' : ratio < 1 ? '(vencedores em pares menos líquidos)' : ''}`);
  }
}

function simulateMinTurnoverFilter(rows: Enriched[], thresholds: number[]) {
  console.log('\n  Simulação filtro turnover mínimo:');
  for (const min of thresholds) {
    const kept = rows.filter((r) => r.turnover1hUsd >= min);
    const st = stats(kept.map((r) => r.netPct));
    console.log(
      `    ≥ $${(min / 1e6).toFixed(min < 1_000_000 ? 1 : 0)}M/h: n=${st?.n ?? 0} WR=${st?.wr.toFixed(1) ?? 0}% $${st?.total.toFixed(0) ?? 0} PF=${st?.pf === Infinity ? '∞' : st?.pf.toFixed(2) ?? 0}`
    );
  }
}

async function main() {
  const { from, to, minStrength, weekdaysOnly } = parseArgs();
  console.log('\n' + '='.repeat(80));
  console.log('MA Cross 15m + Pivot Boss 15m — LUCRO vs TURNOVER/MARKET CAP');
  console.log(`Período: ${from} → ${to} | força ≥ ${minStrength} | ${weekdaysOnly ? 'dias úteis' : 'todos os dias'}`);
  console.log('Proxy: turnover 1h USDT (vela Binance na hora do sinal)');
  console.log('='.repeat(80));

  const all = await fetchSignals(from, to, minStrength);
  const base = weekdaysOnly ? all.filter((s) => !isWeekend(s.generatedAt)) : all;

  const maCrossRaw = base.filter((s) => /ma cross 15m|volume spike 15m/i.test(s.strategyName ?? ''));
  const pivotRaw = base.filter((s) => /pivot boss bear 15m/i.test(s.strategyName ?? ''));

  console.log(`\nSinais: MA Cross ${maCrossRaw.length} | Pivot Boss ${pivotRaw.length}`);
  console.log('\nA buscar turnover 1h por símbolo (Binance)…');

  console.log('\n## MA CROSS 15m (SL/TP sim)');
  const maCross = await enrichWithTurnover(maCrossRaw, netMaCross);
  const stMa = stats(maCross.map((r) => r.netPct));
  console.log(`Total com turnover: n=${stMa?.n ?? 0} WR=${stMa?.wr.toFixed(1) ?? 0}% $${stMa?.total.toFixed(0) ?? 0}`);
  printBucketTable('MA Cross 15m', maCross);
  printWinnersVsLosers('MA Cross 15m', maCross);
  simulateMinTurnoverFilter(maCross, [MA_CROSS_15M_MIN_TURNOVER_1H_USD, 5_000_000, 10_000_000, 20_000_000, 50_000_000]);

  console.log('\n## PIVOT BOSS BEAR 15m (SL 8% fixo)');
  const pivot = await enrichWithTurnover(pivotRaw, netPivotSl8);
  const stPv = stats(pivot.map((r) => r.netPct));
  console.log(`Total com turnover: n=${stPv?.n ?? 0} WR=${stPv?.wr.toFixed(1) ?? 0}% $${stPv?.total.toFixed(0) ?? 0}`);
  printBucketTable('Pivot Boss 15m', pivot);
  printWinnersVsLosers('Pivot Boss 15m', pivot);
  simulateMinTurnoverFilter(pivot, [500_000, 1_000_000, PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD, 10_000_000, 20_000_000]);
  console.log(`\n  Filtro código Pivot Boss (≤ $${PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD / 1e6}M/h): n=${pivot.filter((r) => r.turnover1hUsd <= PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD).length} (de ${pivot.length})`);

  console.log('\n' + '='.repeat(80));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
