/**
 * Estudo diário MA Cross 12×21 vs 12×30 (botscanner).
 * Uso: npx tsx scripts/analyze-ma-cross-daily.ts --from=2026-08-15
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

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    from: get('--from', '2026-01-01'),
    to: get('--to', new Date().toISOString().slice(0, 10)),
    minStrength: Number(get('--minStrength', '0')) || 0,
    out: get('--out', 'scripts/out-ma-cross-daily.json'),
  };
}

function dayPt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

function weekdayPt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
}

function isMaCross21(name: string): boolean {
  return /12×21|12x21/i.test(name);
}

function isMaCross30(name: string): boolean {
  return /12×30|ma cross 12/i.test(name) && !isMaCross21(name);
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { signals?: SignalRow[] };
    all.push(...(json.signals ?? []).filter((s) => s.result24h != null));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  const seen = new Set<string>();
  return all.filter((s) => {
    const k = `${s.strategyName}|${s.symbol}|${s.direction}|${s.generatedAt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return isMaCross21(s.strategyName) || isMaCross30(s.strategyName);
  });
}

function netOf(s: SignalRow): number {
  const side = getSimulationSideForSignal(s.strategyName, s.direction);
  if (!side) return (s.result24h / s.entryPrice) * 100 - FEE;
  return simulateSignalNetResultPercent(s, side, FEE);
}

function summarize(values: number[]) {
  const wins = values.filter((n) => n >= 0);
  const losses = values.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = values.reduce((a, n) => a + n, 0);
  return {
    n: values.length,
    wins: wins.length,
    losses: losses.length,
    winRate: values.length ? (wins.length / values.length) * 100 : 0,
    totalNetPct: total,
    avgNetPct: values.length ? total / values.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
  };
}

type DailyRow = ReturnType<typeof summarize> & {
  date: string;
  weekday: string;
  buyN: number;
  sellN: number;
  buyNet: number;
  sellNet: number;
};

function dailyBreakdown(signals: SignalRow[]): DailyRow[] {
  const byDay = new Map<string, SignalRow[]>();
  for (const s of signals) {
    const d = dayPt(s.generatedAt);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const nets = rows.map((r) => ({ ...r, net: netOf(r) }));
      const buys = nets.filter((r) => r.direction === 'BUY');
      const sells = nets.filter((r) => r.direction === 'SELL');
      return {
        date,
        weekday: weekdayPt(rows[0]!.generatedAt),
        ...summarize(nets.map((r) => r.net)),
        buyN: buys.length,
        sellN: sells.length,
        buyNet: buys.reduce((a, r) => a + r.net, 0),
        sellNet: sells.reduce((a, r) => a + r.net, 0),
      };
    });
}

async function main() {
  const { from, to, minStrength, out } = parseArgs();
  console.log(`MA Cross diário (botscanner) ${from} → ${to}\n`);
  const all = await fetchAll(from, to, minStrength);
  const s21 = all.filter((s) => isMaCross21(s.strategyName));
  const s30 = all.filter((s) => isMaCross30(s.strategyName));

  const payload = {
    source: API,
    from,
    to,
    feePct: FEE,
    method: 'simulateSignalNetResultPercent (SL 15%, TP1 44% 60%, spread exit)',
    strategies: {
      maCross12x21: {
        label: 'MA Cross 12×21 (Scanner 2 top 30)',
        overall: summarize(s21.map(netOf)),
        daily: dailyBreakdown(s21),
      },
      maCross12x30: {
        label: 'MA Cross 12×30 (Scanner 1 top 20)',
        overall: summarize(s30.map(netOf)),
        daily: dailyBreakdown(s30),
      },
    },
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');

  for (const [key, data] of Object.entries(payload.strategies)) {
    const o = data.overall;
    console.log(`\n=== ${data.label} ===`);
    console.log(
      `Total: n=${o.n} WR=${o.winRate.toFixed(1)}% net=${o.totalNetPct.toFixed(1)}% avg=${o.avgNetPct.toFixed(2)}% PF=${o.profitFactor === Infinity ? '∞' : o.profitFactor.toFixed(2)}`
    );
    console.log('Dia       | wd |  n | WR%  |  Net%  | BUY net | SELL net');
    for (const d of data.daily) {
      console.log(
        `${d.date} | ${d.weekday.padEnd(3)} | ${String(d.n).padStart(3)} | ${d.winRate.toFixed(0).padStart(4)} | ${d.totalNetPct.toFixed(1).padStart(7)} | ${d.buyNet.toFixed(1).padStart(7)} | ${d.sellNet.toFixed(1).padStart(8)}`
      );
    }
  }
  console.log(`\nJSON: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
