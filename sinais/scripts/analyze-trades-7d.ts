/**
 * Análise de trades fechados — últimos N dias (botscanner produção).
 * Uso: npx tsx scripts/analyze-trades-7d.ts [--days=7] [--minStrength=0]
 */
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
  const days = Number(get('--days', '7')) || 7;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: get('--from', from.toISOString().slice(0, 10)),
    to: get('--to', to.toISOString().slice(0, 10)),
    minStrength: Number(get('--minStrength', '0')) || 0,
    days,
  };
}

function dayPt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

function weekdayPt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
}

async function fetchAll(from: string, to: string, minStrength: number): Promise<SignalRow[]> {
  const url = `${API}/api/signals?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { signals?: SignalRow[] };
  const seen = new Set<string>();
  return (json.signals ?? [])
    .filter((s) => s.result24h != null)
    .filter((s) => {
      const k = `${s.strategyName}|${s.symbol}|${s.direction}|${s.generatedAt}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const LEGACY_MA21_SELL = {
  stopLossPct: 15,
  tp1Pct: 44,
  tp2Pct: 0,
  tp1PositionPct: 60,
  tp2PositionPct: 0,
  finalCloseHours: 24,
};

function isMaCross21(name: string): boolean {
  return /12.?21/i.test(name);
}

function netOf(s: SignalRow): number {
  let side = getSimulationSideForSignal(s.strategyName, s.direction);
  // SELL históricos antes da migração buy-only (Scanner 7)
  if (!side && s.direction === 'SELL' && isMaCross21(s.strategyName)) {
    side = LEGACY_MA21_SELL;
  }
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
    best: values.length ? Math.max(...values) : 0,
    worst: values.length ? Math.min(...values) : 0,
  };
}

async function main() {
  const { from, to, minStrength, days } = parseArgs();
  console.log(`Trades fechados — últimos ${days} dias (${from} → ${to})`);
  console.log(`Fonte: ${API} | minStrength=${minStrength} | fee=${FEE}%\n`);

  const all = await fetchAll(from, to, minStrength);
  const enriched = all.map((s) => ({ ...s, net: netOf(s) }));

  const byStrategy = new Map<string, typeof enriched>();
  for (const s of enriched) {
    if (!byStrategy.has(s.strategyName)) byStrategy.set(s.strategyName, []);
    byStrategy.get(s.strategyName)!.push(s);
  }

  const strategyRows = [...byStrategy.entries()]
    .map(([name, rows]) => {
      const nets = rows.map((r) => r.net);
      const buys = rows.filter((r) => r.direction === 'BUY');
      const sells = rows.filter((r) => r.direction === 'SELL');
      return {
        name,
        ...summarize(nets),
        buyN: buys.length,
        sellN: sells.length,
        buyNet: buys.reduce((a, r) => a + r.net, 0),
        sellNet: sells.reduce((a, r) => a + r.net, 0),
      };
    })
    .sort((a, b) => b.totalNetPct - a.totalNetPct);

  const overall = summarize(enriched.map((r) => r.net));

  console.log('=== RESUMO GERAL ===');
  console.log(
    `Trades: ${overall.n} | WR: ${overall.winRate.toFixed(1)}% | Net total: ${overall.totalNetPct.toFixed(1)}% | Média/trade: ${overall.avgNetPct.toFixed(2)}% | PF: ${overall.profitFactor === Infinity ? '∞' : overall.profitFactor.toFixed(2)}`
  );
  console.log(`Melhor: +${overall.best.toFixed(2)}% | Pior: ${overall.worst.toFixed(2)}%\n`);

  console.log('=== POR ESTRATÉGIA (ordenado por net total) ===');
  console.log('Estratégia                          |  n | WR%  | Net%   | Avg%  | PF   | BUY n/net | SELL n/net');
  for (const r of strategyRows) {
    const pf = r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2);
    console.log(
      `${r.name.padEnd(35)} | ${String(r.n).padStart(3)} | ${r.winRate.toFixed(0).padStart(4)} | ${r.totalNetPct.toFixed(1).padStart(6)} | ${r.avgNetPct.toFixed(2).padStart(5)} | ${pf.padStart(4)} | ${String(r.buyN).padStart(3)}/${r.buyNet.toFixed(1).padStart(6)} | ${String(r.sellN).padStart(4)}/${r.sellNet.toFixed(1).padStart(7)}`
    );
  }

  const byDay = new Map<string, typeof enriched>();
  for (const s of enriched) {
    const d = dayPt(s.generatedAt);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }

  console.log('\n=== POR DIA (PT) ===');
  console.log('Data       | wd  |  n | WR%  | Net%   | Avg%');
  for (const [date, rows] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const nets = rows.map((r) => r.net);
    const s = summarize(nets);
    console.log(
      `${date} | ${weekdayPt(rows[0]!.generatedAt).padEnd(3)} | ${String(s.n).padStart(3)} | ${s.winRate.toFixed(0).padStart(4)} | ${s.totalNetPct.toFixed(1).padStart(6)} | ${s.avgNetPct.toFixed(2).padStart(5)}`
    );
  }

  const top = [...enriched].sort((a, b) => b.net - a.net).slice(0, 8);
  const bottom = [...enriched].sort((a, b) => a.net - b.net).slice(0, 8);

  console.log('\n=== TOP 8 TRADES ===');
  for (const t of top) {
    console.log(
      `+${t.net.toFixed(2)}% | ${t.symbol.padEnd(12)} ${t.direction.padEnd(4)} | ${t.strategyName} | ${dayPt(t.generatedAt)} str=${t.strength}`
    );
  }

  console.log('\n=== PIOR 8 TRADES ===');
  for (const t of bottom) {
    console.log(
      `${t.net.toFixed(2)}% | ${t.symbol.padEnd(12)} ${t.direction.padEnd(4)} | ${t.strategyName} | ${dayPt(t.generatedAt)} str=${t.strength}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
