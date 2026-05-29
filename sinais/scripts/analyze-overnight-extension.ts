/**
 * Compara MA Cross 15m e Pivot Boss Bear 15m:
 * - setup actual (cron 8–23h PT + guards)
 * - extensão 24h (0–23h PT + guards)
 * - contribuição das horas 0–7h (noite)
 *
 * Uso: npx tsx scripts/analyze-overnight-extension.ts
 */

import {
  MA_CROSS_15M_ALLOWED_HOURS_PT,
  MA_CROSS_15M_TZ,
} from '../lib/maCross15mGuard';
import { PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT } from '../lib/pivotBossGuard';
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const FEE = 0.1;
const API = 'https://botcripto-production.up.railway.app/api/signals';
const TZ = MA_CROSS_15M_TZ;

const CRON_HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 8–23
const OVERNIGHT_HOURS = [0, 1, 2, 3, 4, 5, 6, 7];
const GAP_23_TO_7 = [23, ...OVERNIGHT_HOURS]; // 23h + madrugada 0–7h

type SignalRow = {
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategyName: string;
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
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
    from: get('--from', '2026-01-01'),
    to: get('--to', '2026-12-31'),
    minStrength: Number(get('--minStrength', '70')) || 70,
  };
}

function hourPt(iso: string): number {
  return +new Date(iso).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
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

function stats(nets: number[]) {
  if (!nets.length) return null;
  const wins = nets.filter((n) => n >= 0);
  const losses = nets.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = nets.reduce((a, n) => a + n, 0);
  return {
    n: nets.length,
    wr: (wins.length / nets.length) * 100,
    total,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
  };
}

function fmt(st: ReturnType<typeof stats>) {
  if (!st) return 'n=0';
  return `n=${st.n} WR=${st.wr.toFixed(1)}% $${st.total.toFixed(0)} PF=${st.pf === Infinity ? '∞' : st.pf.toFixed(2)}`;
}

function filterHours(trades: SignalRow[], allowed: readonly number[]): SignalRow[] {
  const set = new Set(allowed);
  return trades.filter((s) => set.has(hourPt(s.generatedAt)));
}

function maCrossCurrentHours(): number[] {
  return CRON_HOURS.filter((h) => MA_CROSS_15M_ALLOWED_HOURS_PT.includes(h));
}

function maCrossExtended24h(): number[] {
  return [...MA_CROSS_15M_ALLOWED_HOURS_PT];
}

function pivotCurrentHours(): number[] {
  return CRON_HOURS.filter((h) => !PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.includes(h));
}

function pivotExtended24h(): number[] {
  return Array.from({ length: 24 }, (_, h) => h).filter(
    (h) => !PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.includes(h)
  );
}

function printHourBreakdown(label: string, trades: SignalRow[], metric: (s: SignalRow) => number) {
  const byHour = new Map<number, SignalRow[]>();
  for (const s of trades) {
    const h = hourPt(s.generatedAt);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(s);
  }
  console.log(`\n  ${label} — por hora:`);
  for (const h of [...byHour.keys()].sort((a, b) => a - b)) {
    const list = byHour.get(h)!;
    const st = stats(list.map(metric))!;
    console.log(`    ${String(h).padStart(2)}h: n=${String(st.n).padStart(3)} WR=${st.wr.toFixed(0)}% $${st.total.toFixed(0)}`);
  }
}

async function fetchSignals(from: string, to: string, minStrength: number) {
  const url = `${API}?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const json = (await res.json()) as { signals?: SignalRow[] };
  return json.signals ?? [];
}

async function main() {
  const { from, to, minStrength } = parseArgs();
  const all = await fetchSignals(from, to, minStrength);

  const maCross = all.filter(
    (s) =>
      s.result24h != null &&
      s.strength >= minStrength &&
      /ma cross 15m|volume spike 15m/i.test(s.strategyName ?? '') &&
      !isWeekend(s.generatedAt)
  );

  const pivot = all.filter(
    (s) =>
      s.result24h != null &&
      s.strength >= minStrength &&
      /pivot boss bear 15m/i.test(s.strategyName ?? '') &&
      !isWeekend(s.generatedAt)
  );

  console.log('\n' + '='.repeat(90));
  console.log('EXTENSÃO NOITE (23h–7h PT) — MA Cross 15m vs Pivot Boss Bear 15m');
  console.log(`Período: ${from} → ${to} | força ≥ ${minStrength} | dias úteis`);
  console.log('='.repeat(90));

  // --- MA Cross ---
  console.log('\n## MA CROSS 15m (métrica: SL/TP sim)');
  console.log(`Whitelist código: ${MA_CROSS_15M_ALLOWED_HOURS_PT.join(', ')}h`);
  console.log(`Horas efectivas cron actual (8–23 ∩ whitelist): ${maCrossCurrentHours().join(', ') || 'nenhuma'}h`);

  const maCurrent = filterHours(maCross, maCrossCurrentHours());
  const maExtended = filterHours(maCross, maCrossExtended24h());
  const maOvernight = filterHours(maCross, OVERNIGHT_HOURS);
  const maOvernightAllowed = filterHours(maCross, OVERNIGHT_HOURS.filter((h) => MA_CROSS_15M_ALLOWED_HOURS_PT.includes(h)));
  const maGap2327 = filterHours(maCross, GAP_23_TO_7);
  const maGapAllowed = filterHours(
    maCross,
    GAP_23_TO_7.filter((h) => MA_CROSS_15M_ALLOWED_HOURS_PT.includes(h))
  );

  console.log(`\n  Actual (cron 8–23 + whitelist):     ${fmt(stats(maCurrent.map(netMaCross)))}`);
  console.log(`  24h (whitelist 3,7,15,17,19):        ${fmt(stats(maExtended.map(netMaCross)))}`);
  console.log(`  Só horas 0–7h (madrugada):           ${fmt(stats(maOvernight.map(netMaCross)))}`);
  console.log(`  Madrugada ∩ whitelist (3h, 7h):      ${fmt(stats(maOvernightAllowed.map(netMaCross)))}`);
  console.log(`  Incremento 24h vs actual:            +$${((stats(maExtended.map(netMaCross))?.total ?? 0) - (stats(maCurrent.map(netMaCross))?.total ?? 0)).toFixed(0)}`);
  printHourBreakdown('Madrugada 0–7h', maOvernight, netMaCross);

  // --- Pivot Boss ---
  console.log('\n## PIVOT BOSS BEAR 15m (métrica: SL 8% fixo)');
  console.log(`Bloqueio código: ${PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.join(', ')}h`);
  console.log(`Horas efectivas cron actual (8–23 − bloqueio): ${pivotCurrentHours().join(', ')}h`);

  const pivotCurrent = filterHours(pivot, pivotCurrentHours());
  const pivotExtended = filterHours(pivot, pivotExtended24h());
  const pivotOvernight = filterHours(pivot, OVERNIGHT_HOURS);
  const pivotGap2327 = filterHours(pivot, GAP_23_TO_7.filter((h) => !PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.includes(h)));

  console.log(`\n  Actual (cron 8–23 − 18h,22h):       ${fmt(stats(pivotCurrent.map(netPivotSl8)))}`);
  console.log(`  24h (− 18h, 22h):                   ${fmt(stats(pivotExtended.map(netPivotSl8)))}`);
  console.log(`  Só horas 0–7h (madrugada):           ${fmt(stats(pivotOvernight.map(netPivotSl8)))}`);
  console.log(`  Faixa 23h + 0–7h (− bloqueios):      ${fmt(stats(pivotGap2327.map(netPivotSl8)))}`);
  console.log(`  Incremento 24h vs actual:            +$${((stats(pivotExtended.map(netPivotSl8))?.total ?? 0) - (stats(pivotCurrent.map(netPivotSl8))?.total ?? 0)).toFixed(0)}`);
  printHourBreakdown('Madrugada 0–7h', pivotOvernight, netPivotSl8);

  // --- Side by side summary ---
  console.log('\n## RESUMO COMPARATIVO');
  console.log('-'.repeat(90));
  console.log('Cenário'.padEnd(42) + 'MA Cross (SL sim)'.padEnd(24) + 'Pivot Boss (SL8)');
  console.log('-'.repeat(90));
  console.log(
    'Actual (cron 8–23 + guards)'.padEnd(42) +
      fmt(stats(maCurrent.map(netMaCross))).padEnd(24) +
      fmt(stats(pivotCurrent.map(netPivotSl8)))
  );
  console.log(
    'Se 24h (+ guards)'.padEnd(42) +
      fmt(stats(maExtended.map(netMaCross))).padEnd(24) +
      fmt(stats(pivotExtended.map(netPivotSl8)))
  );
  console.log(
    'Ganho só madrugada 0–7h'.padEnd(42) +
      `$${(stats(maOvernightAllowed.map(netMaCross))?.total ?? 0).toFixed(0)} (${stats(maOvernightAllowed.map(netMaCross))?.n ?? 0} trades)`.padEnd(24) +
      `$${(stats(pivotOvernight.map(netPivotSl8))?.total ?? 0).toFixed(0)} (${stats(pivotOvernight.map(netPivotSl8))?.n ?? 0} trades)`
  );
  console.log(
    'Ganho incremental 24h'.padEnd(42) +
      `+$${((stats(maExtended.map(netMaCross))?.total ?? 0) - (stats(maCurrent.map(netMaCross))?.total ?? 0)).toFixed(0)}`.padEnd(24) +
      `+$${((stats(pivotExtended.map(netPivotSl8))?.total ?? 0) - (stats(pivotCurrent.map(netPivotSl8))?.total ?? 0)).toFixed(0)}`
  );

  console.log('\n' + '='.repeat(90));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
