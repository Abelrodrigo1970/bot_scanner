/**
 * Pivot Boss Bear 15m (4 EMA venda) — lucro por hora PT (Europe/Lisbon).
 * Compara fecho 24h bruto vs SL 8% fixo vs SL/TP reais do sinal.
 *
 * Uso: npx tsx scripts/analyze-pivot-boss-hourly.ts
 *      npx tsx scripts/analyze-pivot-boss-hourly.ts --from=2026-04-01 --minStrength=70
 */

import { MA_CROSS_15M_TZ } from '../lib/maCross15mGuard';
import { PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT } from '../lib/pivotBossGuard';
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const FEE = 0.1;
const API = 'https://botcripto-production.up.railway.app/api/signals';
const TZ = MA_CROSS_15M_TZ;

/** Janela actual do cron 1h (run-signals): 8h–23h PT. */
export const PIVOT_BOSS_15M_CRON_HOURS_PT: readonly number[] = Array.from(
  { length: 16 },
  (_, i) => i + 8
);

export const PIVOT_BOSS_15M_CRON_BLOCKED_HOURS_PT: readonly number[] = Array.from(
  { length: 24 },
  (_, h) => h
).filter((h) => !PIVOT_BOSS_15M_CRON_HOURS_PT.includes(h));

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

function netRaw(s: SignalRow): number {
  return (s.result24h / s.entryPrice) * 100 - FEE;
}

function netSl8Tp9(s: SignalRow): number {
  const sl = 8;
  const tp1 = 9;
  const tp1W = 0.5;
  const entry = s.entryPrice;
  const base24 = (s.result24h / entry) * 100;
  const slPx = entry * (1 + sl / 100);
  const tp1Px = entry * (1 - tp1 / 100);

  if (s.direction !== 'SELL') {
    const slBuy = entry * (1 - sl / 100);
    const tp1Buy = entry * (1 + tp1 / 100);
    if (s.low24h != null && s.low24h <= slBuy) return -sl - FEE;
    if (s.high24h != null && s.high24h >= tp1Buy) {
      return tp1W * tp1 + (1 - tp1W) * Math.max(base24, -sl) - FEE;
    }
    return Math.max(base24, -sl) - FEE;
  }

  if (s.high24h != null && s.high24h >= slPx) return -sl - FEE;
  if (s.low24h != null && s.low24h <= tp1Px) {
    return tp1W * tp1 + (1 - tp1W) * Math.max(base24, -sl) - FEE;
  }
  return Math.max(base24, -sl) - FEE;
}

function netSim(s: SignalRow): number {
  const side = getSimulationSideForSignal(s.strategyName, s.direction);
  if (!side) return netRaw(s);
  return simulateSignalNetResultPercent(s, side, FEE);
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
    avg: total / nets.length,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
    lossN: losses.length,
    lossSum: losses.reduce((a, n) => a + n, 0),
  };
}

type HourRow = {
  h: number;
  n: number;
  wrSl8: number;
  totalRaw: number;
  totalSl8: number;
  totalSim: number;
  avgSl8: number;
  avgSim: number;
  avgStrength: number;
};

function buildHourTable(trades: SignalRow[]): HourRow[] {
  const byHour = new Map<number, SignalRow[]>();
  for (const s of trades) {
    const h = hourPt(s.generatedAt);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(s);
  }

  const rows: HourRow[] = [];
  for (let h = 0; h < 24; h++) {
    const list = byHour.get(h) ?? [];
    if (!list.length) continue;
    const rawNets = list.map(netRaw);
    const sl8Nets = list.map(netSl8Tp9);
    const simNets = list.map(netSim);
    const stRaw = stats(rawNets)!;
    const stSl8 = stats(sl8Nets)!;
    const stSim = stats(simNets)!;
    rows.push({
      h,
      n: list.length,
      wrSl8: stSl8.wr,
      totalRaw: stRaw.total,
      totalSl8: stSl8.total,
      totalSim: stSim.total,
      avgSl8: stSl8.avg,
      avgSim: stSim.avg,
      avgStrength: list.reduce((a, s) => a + s.strength, 0) / list.length,
    });
  }
  return rows;
}

function printHourTable(title: string, rows: HourRow[]) {
  console.log(`\n### ${title} ###`);
  console.log('Hora | n  | WR(SL8) | Liq bruto | Liq SL8% | Liq SL real | Avg SL8 | Força méd');
  console.log('-'.repeat(88));
  const sorted = [...rows].sort((a, b) => a.totalSl8 - b.totalSl8);
  for (const r of sorted) {
    const tag =
      r.totalSl8 < -10 ? ' ⚠️' : r.totalSl8 > 20 ? ' ✓' : '';
    console.log(
      `${String(r.h).padStart(2)}h | ${String(r.n).padStart(3)} | ${r.wrSl8.toFixed(0).padStart(6)}% | ${r.totalRaw.toFixed(0).padStart(8)}% | ${r.totalSl8.toFixed(0).padStart(7)}% | ${r.totalSim.toFixed(0).padStart(10)}% | ${r.avgSl8.toFixed(2).padStart(6)}% | ${r.avgStrength.toFixed(1).padStart(8)}${tag}`
    );
  }
}

function filterExcludeHours(trades: SignalRow[], blocked: readonly number[]): SignalRow[] {
  const set = new Set(blocked);
  return trades.filter((s) => !set.has(hourPt(s.generatedAt)));
}

function printScenario(
  label: string,
  kept: SignalRow[],
  blocked: SignalRow[],
  metric: (s: SignalRow) => number
) {
  const st = stats(kept.map(metric));
  const bLoss = blocked.filter((s) => metric(s) < 0);
  const bWin = blocked.filter((s) => metric(s) >= 0);
  console.log(
    `\n${label}:` +
      ` n=${st?.n ?? 0} WR=${st?.wr.toFixed(1) ?? 0}% $${st?.total.toFixed(0) ?? 0} PF=${st?.pf === Infinity ? '∞' : st?.pf.toFixed(2) ?? 0}`
  );
  if (blocked.length) {
    console.log(
      `  Removidos: ${blocked.length} | perdas evitadas: ${bLoss.length} ($${bLoss.reduce((a, s) => a + metric(s), 0).toFixed(0)}) | ganhos perdidos: ${bWin.length} ($${bWin.reduce((a, s) => a + metric(s), 0).toFixed(0)})`
    );
  }
}

async function main() {
  const { from, to, minStrength } = parseArgs();
  const url = `${API}?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`API HTTP ${res.status}`);
    process.exit(1);
  }
  const json = (await res.json()) as { signals?: SignalRow[] };
  const all = (json.signals ?? []).filter(
    (s) =>
      s.result24h != null &&
      s.strength >= minStrength &&
      /pivot boss bear 15m/i.test(s.strategyName ?? '')
  );

  const weekdays = all.filter((s) => !isWeekend(s.generatedAt));
  const hourRows = buildHourTable(weekdays);
  const stAllRaw = stats(weekdays.map(netRaw));
  const stAllSl8 = stats(weekdays.map(netSl8Tp9));
  const stAllSim = stats(weekdays.map(netSim));

  console.log('\n' + '='.repeat(88));
  console.log('Pivot Boss Bear 15m (4 EMA venda) — ANÁLISE POR HORA PT');
  console.log(`Período: ${from} → ${to} | força ≥ ${minStrength} | dias úteis | fee ${FEE}%`);
  console.log(`Sinais: ${all.length} total | ${weekdays.length} dias úteis | só SELL`);
  console.log('='.repeat(88));

  if (!weekdays.length) {
    console.log('Sem sinais.');
    return;
  }

  console.log(
    `\nTOTAL dias úteis: bruto 24h WR=${stAllRaw!.wr.toFixed(1)}% $${stAllRaw!.total.toFixed(0)} PF=${stAllRaw!.pf.toFixed(2)}`
  );
  console.log(
    `TOTAL dias úteis: SL 8% fixo WR=${stAllSl8!.wr.toFixed(1)}% $${stAllSl8!.total.toFixed(0)} PF=${stAllSl8!.pf.toFixed(2)}`
  );
  console.log(
    `TOTAL dias úteis: SL/TP real WR=${stAllSim!.wr.toFixed(1)}% $${stAllSim!.total.toFixed(0)} PF=${stAllSim!.pf.toFixed(2)}`
  );

  printHourTable('TODAS AS HORAS (ordenado por lucro SL 8% fixo)', hourRows);

  const minN = 3;
  const toxicSl8 = hourRows
    .filter((r) => r.totalSl8 < 0 && r.n >= minN)
    .map((r) => r.h)
    .sort((a, b) => a - b);
  const strongSl8 = hourRows
    .filter((r) => r.totalSl8 > 15 && r.n >= minN)
    .map((r) => r.h)
    .sort((a, b) => a - b);

  console.log(`\nHoras tóxicas SL8 (sim < 0, n≥${minN}): ${toxicSl8.map((h) => `${h}h`).join(', ') || 'nenhuma'}`);
  console.log(`Horas fortes SL8 (sim > $15, n≥${minN}): ${strongSl8.map((h) => `${h}h`).join(', ') || 'nenhuma'}`);
  console.log(
    `Horas bloqueadas no código: ${PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.map((h) => `${h}h`).join(', ')}`
  );
  console.log(
    `Janela cron actual (8–23h PT): ${PIVOT_BOSS_15M_CRON_HOURS_PT.map((h) => `${h}h`).join(', ')}`
  );
  console.log(
    `Fora do cron: ${PIVOT_BOSS_15M_CRON_BLOCKED_HOURS_PT.map((h) => `${h}h`).join(', ')}`
  );

  console.log('\n### SIMULAÇÃO BLOQUEIO HORÁRIO (SL 8% fixo, dias úteis) ###');
  const scenarios: { label: string; blocked: readonly number[] }[] = [
    { label: 'Sem bloqueio', blocked: [] },
    { label: 'Bloqueio código (18h, 22h)', blocked: PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT },
    { label: 'Cron actual 8–23h PT', blocked: PIVOT_BOSS_15M_CRON_BLOCKED_HOURS_PT },
    { label: 'Horas tóxicas auto (SL8)', blocked: toxicSl8 },
    {
      label: 'Whitelist horas fortes (SL8)',
      blocked: Array.from({ length: 24 }, (_, h) => h).filter((h) => !strongSl8.includes(h)),
    },
  ];

  for (const sc of scenarios) {
    const kept = sc.blocked.length ? filterExcludeHours(weekdays, sc.blocked) : weekdays;
    const blocked = sc.blocked.length
      ? weekdays.filter((s) => new Set(sc.blocked).has(hourPt(s.generatedAt)))
      : [];
    printScenario(sc.label, kept, blocked, netSl8Tp9);
  }

  console.log('\n### POR FORÇA × HORA (SL 8%, top horas com n≥3) ###');
  const byStrengthHour = new Map<string, { n: number; total: number }>();
  for (const s of weekdays) {
    const bucket =
      s.strength >= 75 ? '75-80' : s.strength >= 70 ? '70-74' : '<70';
    const key = `${hourPt(s.generatedAt)}h|${bucket}`;
    const cur = byStrengthHour.get(key) ?? { n: 0, total: 0 };
    cur.n++;
    cur.total += netSl8Tp9(s);
    byStrengthHour.set(key, cur);
  }
  const strengthRows = [...byStrengthHour.entries()]
    .map(([key, v]) => {
      const [h, bucket] = key.split('|');
      return { h, bucket, ...v };
    })
    .filter((r) => r.n >= 3)
    .sort((a, b) => b.total - a.total);
  console.log('Hora | Força | n | Lucro SL8%');
  console.log('-'.repeat(40));
  for (const r of strengthRows.slice(0, 12)) {
    console.log(`${r.h.padStart(4)} | ${r.bucket.padEnd(5)} | ${String(r.n).padStart(2)} | $${r.total.toFixed(0)}`);
  }

  console.log('\n### TOP 5 MELHORES / PIORES HORAS (SL 8% fixo) ###');
  const bySl8 = [...hourRows].sort((a, b) => b.totalSl8 - a.totalSl8);
  console.log('Melhores:');
  for (const r of bySl8.slice(0, 5)) {
    console.log(
      `  ${r.h}h: n=${r.n} $${r.totalSl8.toFixed(0)} WR=${r.wrSl8.toFixed(0)}% (bruto $${r.totalRaw.toFixed(0)} / SL real $${r.totalSim.toFixed(0)})`
    );
  }
  console.log('Piores:');
  for (const r of bySl8.slice(-5).reverse()) {
    console.log(
      `  ${r.h}h: n=${r.n} $${r.totalSl8.toFixed(0)} WR=${r.wrSl8.toFixed(0)}% (bruto $${r.totalRaw.toFixed(0)} / SL real $${r.totalSim.toFixed(0)})`
    );
  }

  console.log('\n' + '='.repeat(88));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
