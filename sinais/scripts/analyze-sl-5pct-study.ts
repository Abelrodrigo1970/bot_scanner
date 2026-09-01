/**
 * Estudo: SL actual vs SL 5% em todas as estratégias (últimos N dias).
 * Uso: npx tsx scripts/analyze-sl-5pct-study.ts [--days=7]
 */
import {
  type StrategySimulationSide,
  getSimulationSideForSignal,
} from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const API = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const FEE = 0.1;
const NEW_SL = 5;

const LEGACY_MA21_SELL: StrategySimulationSide = {
  stopLossPct: 15,
  tp1Pct: 44,
  tp2Pct: 0,
  tp1PositionPct: 60,
  tp2PositionPct: 0,
  finalCloseHours: 24,
};

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

function isMaCross21(name: string) {
  return /12.?21/i.test(name);
}

function getSide(s: SignalRow): StrategySimulationSide | null {
  let side = getSimulationSideForSignal(s.strategyName, s.direction);
  if (!side && s.direction === 'SELL' && isMaCross21(s.strategyName)) side = LEGACY_MA21_SELL;
  return side;
}

function signalWithSl(signal: SignalRow, slPct: number): SignalRow {
  const entry = signal.entryPrice;
  const stopLoss =
    signal.direction === 'BUY' ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
  return { ...signal, stopLoss };
}

function sideWithSl(base: StrategySimulationSide, slPct: number): StrategySimulationSide {
  return { ...base, stopLossPct: slPct };
}

function netOf(s: SignalRow, slPct: number | 'current'): number | null {
  const base = getSide(s);
  if (!base) return null;
  const sl = slPct === 'current' ? base.stopLossPct : slPct;
  const side = sideWithSl(base, sl);
  return simulateSignalNetResultPercent(signalWithSl(s, sl), side, FEE);
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
    winRate: values.length ? (wins.length / values.length) * 100 : 0,
    totalNetPct: total,
    avgNetPct: values.length ? total / values.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
    maxLoss: values.length ? Math.min(...values) : 0,
  };
}

function countSlHits(values: number[], slPct: number) {
  return values.filter((n) => Math.abs(n + FEE + slPct) < 0.15).length;
}

async function fetchAll(from: string, to: string, minStrength: number): Promise<SignalRow[]> {
  const url = `${API}/api/signals?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { signals?: SignalRow[] };
  const seen = new Set<string>();
  return (json.signals ?? [])
    .filter((s) => s.result24h != null && getSide(s) != null)
    .filter((s) => {
      const k = `${s.strategyName}|${s.symbol}|${s.direction}|${s.generatedAt}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

async function main() {
  const { from, to, minStrength, days } = parseArgs();
  const signals = await fetchAll(from, to, minStrength);

  const rows = signals.map((s) => {
    const base = getSide(s)!;
    const cur = netOf(s, 'current')!;
    const sl5 = netOf(s, NEW_SL)!;
    return {
      strategy: s.strategyName,
      symbol: s.symbol,
      direction: s.direction,
      currentSl: base.stopLossPct,
      cur,
      sl5,
      delta: sl5 - cur,
      improved: sl5 > cur,
    };
  });

  const curNets = rows.map((r) => r.cur);
  const sl5Nets = rows.map((r) => r.sl5);

  console.log(`=== ESTUDO SL 5% vs SL ACTUAL (${from} → ${to}, ${days} dias) ===`);
  console.log(`Sinais simuláveis: ${rows.length} | fee ${FEE}%\n`);

  const curS = summarize(curNets);
  const sl5S = summarize(sl5Nets);
  console.log('RESUMO GERAL');
  console.log(
    `SL actual:  n=${curS.n} WR=${curS.winRate.toFixed(1)}% net=${curS.totalNetPct.toFixed(1)}% avg=${curS.avgNetPct.toFixed(2)}% PF=${curS.profitFactor === Infinity ? '∞' : curS.profitFactor.toFixed(2)} pior=${curS.maxLoss.toFixed(2)}%`
  );
  console.log(
    `SL 5%:      n=${sl5S.n} WR=${sl5S.winRate.toFixed(1)}% net=${sl5S.totalNetPct.toFixed(1)}% avg=${sl5S.avgNetPct.toFixed(2)}% PF=${sl5S.profitFactor === Infinity ? '∞' : sl5S.profitFactor.toFixed(2)} pior=${sl5S.maxLoss.toFixed(2)}%`
  );
  console.log(
    `Δ net: ${(sl5S.totalNetPct - curS.totalNetPct).toFixed(1)}% | trades melhorados: ${rows.filter((r) => r.improved).length}/${rows.length} | piores: ${rows.filter((r) => !r.improved && r.delta !== 0).length}\n`
  );

  const byStrat = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byStrat.has(r.strategy)) byStrat.set(r.strategy, []);
    byStrat.get(r.strategy)!.push(r);
  }

  console.log('POR ESTRATÉGIA (SL actual → SL 5%)');
  console.log('Estratégia                          | SL |  n | WR act | Net act | Net 5%  | Δ net  | SL hits 5%');
  const stratRows = [...byStrat.entries()]
    .map(([name, items]) => {
      const cur = summarize(items.map((i) => i.cur));
      const sl5 = summarize(items.map((i) => i.sl5));
      const slActual = items[0]!.currentSl;
      const hits5 = countSlHits(items.map((i) => i.sl5), NEW_SL);
      return { name, slActual, cur, sl5, hits5, delta: sl5.totalNetPct - cur.totalNetPct };
    })
    .sort((a, b) => b.delta - a.delta);

  for (const r of stratRows) {
    const note = r.slActual === 5 ? '(já 5%)' : `${r.slActual}%→5%`;
    console.log(
      `${r.name.padEnd(35)} | ${String(r.slActual).padStart(2)} | ${String(r.cur.n).padStart(3)} | ${r.cur.winRate.toFixed(0).padStart(6)} | ${r.cur.totalNetPct.toFixed(1).padStart(7)} | ${r.sl5.totalNetPct.toFixed(1).padStart(7)} | ${r.delta.toFixed(1).padStart(6)} | ${String(r.hits5).padStart(3)} ${note}`
    );
  }

  console.log('\nMAIORES GANHOS com SL 5% (vs actual)');
  for (const r of [...rows].sort((a, b) => b.delta - a.delta).slice(0, 10)) {
    if (r.delta <= 0.01) continue;
    console.log(
      `+${r.delta.toFixed(2)}% | ${r.symbol.padEnd(12)} ${r.direction} | ${r.strategy} | actual ${r.cur.toFixed(1)}% → 5% ${r.sl5.toFixed(1)}%`
    );
  }

  console.log('\nMAIORES PERDAS com SL 5% (vs actual)');
  for (const r of [...rows].sort((a, b) => a.delta - b.delta).slice(0, 10)) {
    if (r.delta >= -0.01) continue;
    console.log(
      `${r.delta.toFixed(2)}% | ${r.symbol.padEnd(12)} ${r.direction} | ${r.strategy} | actual ${r.cur.toFixed(1)}% → 5% ${r.sl5.toFixed(1)}%`
    );
  }

  // BUY vs SELL
  const buys = rows.filter((r) => r.direction === 'BUY');
  const sells = rows.filter((r) => r.direction === 'SELL');
  const buyCur = summarize(buys.map((r) => r.cur));
  const buy5 = summarize(buys.map((r) => r.sl5));
  const sellCur = summarize(sells.map((r) => r.cur));
  const sell5 = summarize(sells.map((r) => r.sl5));

  console.log('\nPOR DIRECÇÃO');
  console.log(
    `BUY:  actual net=${buyCur.totalNetPct.toFixed(1)}% → SL5 ${buy5.totalNetPct.toFixed(1)}% (Δ ${(buy5.totalNetPct - buyCur.totalNetPct).toFixed(1)}%)`
  );
  console.log(
    `SELL: actual net=${sellCur.totalNetPct.toFixed(1)}% → SL5 ${sell5.totalNetPct.toFixed(1)}% (Δ ${(sell5.totalNetPct - sellCur.totalNetPct).toFixed(1)}%)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
