/**
 * MA Cross 15m (MA12/MA30) — lucro por hora PT (Europe/Lisbon).
 * Compara fecho 24h bruto vs SL/TP reais do sinal (high24h/low24h).
 *
 * Uso: npx tsx scripts/analyze-ma-cross-hourly.ts
 *      npx tsx scripts/analyze-ma-cross-hourly.ts --from=2026-04-01 --minStrength=70
 */

import {
  MA_CROSS_15M_ALLOWED_HOURS_PT,
  MA_CROSS_15M_BLOCKED_HOURS_PT,
  MA_CROSS_15M_TZ,
} from '../lib/maCross15mGuard';
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const FEE = 0.1;
const API = 'https://botcripto-production.up.railway.app/api/signals';
const TZ = MA_CROSS_15M_TZ;

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
  wr: number;
  totalRaw: number;
  totalSim: number;
  avgRaw: number;
  avgSim: number;
  buyN: number;
  sellN: number;
  buySim: number;
  sellSim: number;
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
    const simNets = list.map(netSim);
    const stRaw = stats(rawNets)!;
    const stSim = stats(simNets)!;
    const buys = list.filter((s) => s.direction === 'BUY');
    const sells = list.filter((s) => s.direction === 'SELL');
    rows.push({
      h,
      n: list.length,
      wr: stSim.wr,
      totalRaw: stRaw.total,
      totalSim: stSim.total,
      avgRaw: stRaw.avg,
      avgSim: stSim.avg,
      buyN: buys.length,
      sellN: sells.length,
      buySim: buys.reduce((a, s) => a + netSim(s), 0),
      sellSim: sells.reduce((a, s) => a + netSim(s), 0),
    });
  }
  return rows;
}

function printHourTable(title: string, rows: HourRow[]) {
  console.log(`\n### ${title} ###`);
  console.log(
    'Hora | n  | BUY/SELL | WR(sim) | Liq bruto | Liq SL/TP | Avg sim | BUY $ | SELL $'
  );
  console.log('-'.repeat(88));
  const sorted = [...rows].sort((a, b) => a.totalSim - b.totalSim);
  for (const r of sorted) {
    const tag =
      r.totalSim < -15 ? ' ⚠️' : r.totalSim > 40 ? ' ✓' : '';
    console.log(
      `${String(r.h).padStart(2)}h | ${String(r.n).padStart(3)} | ${String(r.buyN).padStart(2)}/${String(r.sellN).padStart(2)}   | ${r.wr.toFixed(0).padStart(5)}% | ${r.totalRaw.toFixed(0).padStart(8)}% | ${r.totalSim.toFixed(0).padStart(8)}% | ${r.avgSim.toFixed(2).padStart(6)}% | ${r.buySim.toFixed(0).padStart(5)}% | ${r.sellSim.toFixed(0).padStart(5)}%${tag}`
    );
  }
}

function filterExcludeHours(trades: SignalRow[], blocked: readonly number[]): SignalRow[] {
  const set = new Set(blocked);
  return trades.filter((s) => !set.has(hourPt(s.generatedAt)));
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
      /ma cross 15m|volume spike 15m/i.test(s.strategyName ?? '')
  );

  const weekdays = all.filter((s) => !isWeekend(s.generatedAt));
  const hourRows = buildHourTable(weekdays);
  const stAllRaw = stats(weekdays.map(netRaw));
  const stAllSim = stats(weekdays.map(netSim));

  console.log('\n' + '='.repeat(88));
  console.log('MA Cross 15m (MA12/MA30) — ANÁLISE POR HORA PT');
  console.log(`Período: ${from} → ${to} | força ≥ ${minStrength} | dias úteis | fee ${FEE}%`);
  console.log(`Sinais: ${all.length} total | ${weekdays.length} dias úteis`);
  console.log('='.repeat(88));

  if (!weekdays.length) {
    console.log('Sem sinais.');
    return;
  }

  console.log(
    `\nTOTAL dias úteis: bruto 24h WR=${stAllRaw!.wr.toFixed(1)}% $${stAllRaw!.total.toFixed(0)} PF=${stAllRaw!.pf.toFixed(2)}`
  );
  console.log(
    `TOTAL dias úteis: SL/TP real WR=${stAllSim!.wr.toFixed(1)}% $${stAllSim!.total.toFixed(0)} PF=${stAllSim!.pf.toFixed(2)}`
  );

  printHourTable('TODAS AS HORAS (ordenado por lucro SL/TP sim)', hourRows);

  const toxic = hourRows
    .filter((r) => r.totalSim < 0 && r.n >= 4)
    .map((r) => r.h)
    .sort((a, b) => a - b);
  const strong = hourRows
    .filter((r) => r.totalSim > 25 && r.n >= 4)
    .map((r) => r.h)
    .sort((a, b) => a - b);

  console.log(`\nHoras tóxicas (sim < 0, n≥4): ${toxic.map((h) => `${h}h`).join(', ') || 'nenhuma'}`);
  console.log(`Horas fortes (sim > $25, n≥4): ${strong.map((h) => `${h}h`).join(', ') || 'nenhuma'}`);
  console.log(
    `Horas permitidas no código: ${MA_CROSS_15M_ALLOWED_HOURS_PT.map((h) => `${h}h`).join(', ')}`
  );
  console.log(
    `Horas bloqueadas no código: ${MA_CROSS_15M_BLOCKED_HOURS_PT.map((h) => `${h}h`).join(', ')}`
  );

  console.log('\n### SIMULAÇÃO BLOQUEIO HORÁRIO (SL/TP sim, dias úteis) ###');
  const scenarios: { label: string; blocked: readonly number[] }[] = [
    { label: 'Sem bloqueio', blocked: [] },
    { label: 'Whitelist código (3,7,15,17,19h)', blocked: MA_CROSS_15M_BLOCKED_HOURS_PT },
    { label: 'Horas tóxicas auto', blocked: toxic },
  ];

  for (const sc of scenarios) {
    const kept = sc.blocked.length ? filterExcludeHours(weekdays, sc.blocked) : weekdays;
    const blocked = sc.blocked.length
      ? weekdays.filter((s) => new Set(sc.blocked).has(hourPt(s.generatedAt)))
      : [];
    const st = stats(kept.map(netSim));
    const bLoss = blocked.filter((s) => netSim(s) < 0);
    const bWin = blocked.filter((s) => netSim(s) >= 0);
    console.log(
      `\n${sc.label}:` +
        ` n=${st?.n ?? 0} WR=${st?.wr.toFixed(1) ?? 0}% $${st?.total.toFixed(0) ?? 0} PF=${st?.pf === Infinity ? '∞' : st?.pf.toFixed(2) ?? 0}`
    );
    if (blocked.length) {
      console.log(
        `  Removidos: ${blocked.length} | perdas evitadas: ${bLoss.length} ($${bLoss.reduce((a, s) => a + netSim(s), 0).toFixed(0)}) | ganhos perdidos: ${bWin.length} ($${bWin.reduce((a, s) => a + netSim(s), 0).toFixed(0)})`
      );
    }
  }

  console.log('\n### TOP 5 MELHORES / PIORES HORAS (SL/TP sim) ###');
  const bySim = [...hourRows].sort((a, b) => b.totalSim - a.totalSim);
  console.log('Melhores:');
  for (const r of bySim.slice(0, 5)) {
    console.log(`  ${r.h}h: n=${r.n} $${r.totalSim.toFixed(0)} WR=${r.wr.toFixed(0)}% (BUY $${r.buySim.toFixed(0)} / SELL $${r.sellSim.toFixed(0)})`);
  }
  console.log('Piores:');
  for (const r of bySim.slice(-5).reverse()) {
    console.log(`  ${r.h}h: n=${r.n} $${r.totalSim.toFixed(0)} WR=${r.wr.toFixed(0)}% (BUY $${r.buySim.toFixed(0)} / SELL $${r.sellSim.toFixed(0)})`);
  }

  console.log('\n' + '='.repeat(88));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
