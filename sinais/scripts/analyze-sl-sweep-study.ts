/**
 * Estudo SL sweep: global (5/10/actual) + MA Cross 12×21 BUY only.
 * Uso: npx tsx scripts/analyze-sl-sweep-study.ts [--days=7]
 */
import {
  type StrategySimulationSide,
  getSimulationSideForSignal,
} from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const API = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const FEE = 0.1;
const SWEEP = [5, 10, 15] as const;

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

function netOf(s: SignalRow, slPct: number): number {
  const base = getSide(s)!;
  const side = sideWithSl(base, slPct);
  return simulateSignalNetResultPercent(signalWithSl(s, slPct), side, FEE);
}

function netCurrent(s: SignalRow): number {
  const base = getSide(s)!;
  return simulateSignalNetResultPercent(signalWithSl(s, base.stopLossPct), base, FEE);
}

function summarize(values: number[]) {
  const wins = values.filter((n) => n >= 0);
  const losses = values.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = values.reduce((a, n) => a + n, 0);
  return {
    n: values.length,
    winRate: values.length ? (wins.length / values.length) * 100 : 0,
    totalNetPct: total,
    avgNetPct: values.length ? total / values.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
    maxLoss: values.length ? Math.min(...values) : 0,
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

function effectiveSl(s: SignalRow): number {
  return getSide(s)!.stopLossPct;
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

/** Para estratégias já em 5%, SL 10% significa alargar — só aplicar sweep onde SL actual > nível testado */
function netWithOverride(s: SignalRow, targetSl: number): number {
  const actual = effectiveSl(s);
  const sl = Math.min(actual, targetSl); // nunca alargar SL além do actual no sweep "reduzir"
  return netOf(s, sl);
}

function netGlobalOverride(s: SignalRow, targetSl: number): number {
  const actual = effectiveSl(s);
  if (actual <= targetSl) return netCurrent(s); // já igual ou mais apertado
  return netOf(s, targetSl);
}

async function main() {
  const { from, to, minStrength, days } = parseArgs();
  const signals = await fetchAll(from, to, minStrength);

  console.log(`=== ESTUDO SL SWEEP (${from} → ${to}, ${days}d) ===`);
  console.log(`Sinais: ${signals.length} | fee ${FEE}%\n`);

  // ── PARTE 1: GLOBAL (actual vs forçar max SL 10% vs max SL 5%) ──
  console.log('═══════════════════════════════════════════════════');
  console.log(' PARTE 1 — TODAS ESTRATÉGIAS (SL reduzido, TP igual)');
  console.log('═══════════════════════════════════════════════════\n');

  const curNets = signals.map(netCurrent);
  const sl10Nets = signals.map((s) => netGlobalOverride(s, 10));
  const sl5Nets = signals.map((s) => netGlobalOverride(s, 5));

  const curS = summarize(curNets);
  const s10 = summarize(sl10Nets);
  const s5 = summarize(sl5Nets);

  console.log('SL%      |  n |  WR%  | Net total | Avg/trade |   PF  | Pior');
  for (const [label, s] of [
    ['Actual', curS],
    ['Max 10%', s10],
    ['Max 5%', s5],
  ] as const) {
    const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
    console.log(
      `${label.padEnd(8)} | ${String(s.n).padStart(3)} | ${s.winRate.toFixed(1).padStart(5)} | ${s.totalNetPct.toFixed(1).padStart(9)} | ${s.avgNetPct.toFixed(2).padStart(9)} | ${pf.padStart(5)} | ${s.maxLoss.toFixed(1)}%`
    );
  }
  console.log(`\nΔ vs actual: SL10 ${(s10.totalNetPct - curS.totalNetPct).toFixed(1)}% | SL5 ${(s5.totalNetPct - curS.totalNetPct).toFixed(1)}%`);

  const byStrat = new Map<string, SignalRow[]>();
  for (const s of signals) {
    if (!byStrat.has(s.strategyName)) byStrat.set(s.strategyName, []);
    byStrat.get(s.strategyName)!.push(s);
  }

  console.log('\nPor estratégia (actual → SL10 → SL5):');
  console.log('Estratégia                          | SL |  n | Net act | Net 10% | Net 5%  | Melhor');
  for (const [name, items] of [...byStrat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const actualSl = effectiveSl(items[0]!);
    const nc = summarize(items.map(netCurrent));
    const n10 = summarize(items.map((s) => netGlobalOverride(s, 10)));
    const n5 = summarize(items.map((s) => netGlobalOverride(s, 5)));
    const best = [
      { l: 'act', v: nc.totalNetPct },
      { l: '10%', v: n10.totalNetPct },
      { l: '5%', v: n5.totalNetPct },
    ].sort((a, b) => b.v - a.v)[0]!;
    console.log(
      `${name.padEnd(35)} | ${String(actualSl).padStart(2)} | ${String(items.length).padStart(3)} | ${nc.totalNetPct.toFixed(1).padStart(7)} | ${n10.totalNetPct.toFixed(1).padStart(7)} | ${n5.totalNetPct.toFixed(1).padStart(7)} | ${best.l} (${best.v.toFixed(1)}%)`
    );
  }

  const buys = signals.filter((s) => s.direction === 'BUY');
  const sells = signals.filter((s) => s.direction === 'SELL');
  console.log('\nPor direcção:');
  for (const [label, subset] of [
    ['BUY', buys],
    ['SELL', sells],
  ] as const) {
    const c = summarize(subset.map(netCurrent));
    const t = summarize(subset.map((s) => netGlobalOverride(s, 10)));
    const f = summarize(subset.map((s) => netGlobalOverride(s, 5)));
    console.log(
      `  ${label}: actual ${c.totalNetPct.toFixed(1)}% → SL10 ${t.totalNetPct.toFixed(1)}% (Δ${(t.totalNetPct - c.totalNetPct).toFixed(1)}) → SL5 ${f.totalNetPct.toFixed(1)}% (Δ${(f.totalNetPct - c.totalNetPct).toFixed(1)})`
    );
  }

  // ── PARTE 2: MA Cross 12×21 BUY ONLY (Scanner 7 buy-only) ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' PARTE 2 — MA Cross 12×21 BUY ONLY (Scanner 7)');
  console.log('═══════════════════════════════════════════════════\n');

  const ma21Buy = signals.filter((s) => isMaCross21(s.strategyName) && s.direction === 'BUY');
  if (!ma21Buy.length) {
    console.log('Sem sinais MA Cross 12×21 BUY no período.');
  } else {
    console.log(`Sinais BUY: ${ma21Buy.length}\n`);
    console.log('SL%  |  n |  WR%  | Net total | Avg/trade |   PF  | SL hits | Pior');
    let bestSl = 15;
    let bestNet = -Infinity;
    for (const sl of SWEEP) {
      const nets = ma21Buy.map((s) => netOf(s, sl));
      const sm = summarize(nets);
      const hits = countSlHits(ma21Buy, sl);
      const pf = sm.profitFactor === Infinity ? '∞' : sm.profitFactor.toFixed(2);
      console.log(
        `${String(sl).padStart(3)}% | ${String(sm.n).padStart(3)} | ${sm.winRate.toFixed(1).padStart(5)} | ${sm.totalNetPct.toFixed(1).padStart(9)} | ${sm.avgNetPct.toFixed(2).padStart(9)} | ${pf.padStart(5)} | ${String(hits).padStart(7)} | ${sm.maxLoss.toFixed(1)}%`
      );
      if (sm.totalNetPct > bestNet) {
        bestNet = sm.totalNetPct;
        bestSl = sl;
      }
    }
    console.log(`\n→ Melhor SL histórico (7d BUY): ${bestSl}% (net ${bestNet.toFixed(1)}%)`);

    console.log('\nDetalhe por dia (SL 10% vs SL 15%):');
    const byDay = new Map<string, SignalRow[]>();
    for (const s of ma21Buy) {
      const d = s.generatedAt.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(s);
    }
    console.log('Data       |  n | Net 15% | Net 10% | Net 5%');
    for (const [d, items] of [...byDay.entries()].sort()) {
      const n15 = summarize(items.map((s) => netOf(s, 15)));
      const n10 = summarize(items.map((s) => netOf(s, 10)));
      const n5 = summarize(items.map((s) => netOf(s, 5)));
      console.log(
        `${d} | ${String(items.length).padStart(3)} | ${n15.totalNetPct.toFixed(1).padStart(7)} | ${n10.totalNetPct.toFixed(1).padStart(7)} | ${n5.totalNetPct.toFixed(1).padStart(7)}`
      );
    }

    console.log('\nTrades BUY (actual SL15 vs SL10):');
    const cmp = ma21Buy.map((s) => ({
      sym: s.symbol,
      at: s.generatedAt.slice(0, 16),
      n15: netOf(s, 15),
      n10: netOf(s, 10),
      n5: netOf(s, 5),
    }));
    const improved10 = cmp.filter((r) => r.n10 > r.n15 + 0.01).length;
    const worse10 = cmp.filter((r) => r.n10 < r.n15 - 0.01).length;
    console.log(`  SL10 vs SL15: ${improved10} melhor, ${worse10} pior, ${cmp.length - improved10 - worse10} igual`);
    const improved5 = cmp.filter((r) => r.n5 > r.n15 + 0.01).length;
    console.log(`  SL5 vs SL15:  ${improved5} melhor, ${cmp.length - improved5} igual/pior`);
  }

  // ── PARTE 3: Recomendação ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' RECOMENDAÇÃO');
  console.log('═══════════════════════════════════════════════════');
  const engolfo = byStrat.get('engolfo');
  if (engolfo) {
    const eCur = summarize(engolfo.map(netCurrent));
    const e10 = summarize(engolfo.map((s) => netGlobalOverride(s, 10)));
    console.log(`engolfo: manter SL 10% (actual ${eCur.totalNetPct.toFixed(1)}% vs forçar ${e10.totalNetPct.toFixed(1)}% — ${eCur.totalNetPct >= e10.totalNetPct ? 'actual OK' : 'reduzir?'})`);
  }
  if (ma21Buy.length) {
    const b15 = summarize(ma21Buy.map((s) => netOf(s, 15)));
    const b10 = summarize(ma21Buy.map((s) => netOf(s, 10)));
    const b5 = summarize(ma21Buy.map((s) => netOf(s, 5)));
    const rec =
      b10.totalNetPct >= b15.totalNetPct && b10.totalNetPct >= b5.totalNetPct
        ? 'SL 10%'
        : b5.totalNetPct >= b15.totalNetPct
          ? 'SL 5%'
          : 'SL 15% (actual)';
    console.log(`MA Cross 12×21 BUY: ${rec} — 15%=${b15.totalNetPct.toFixed(1)}% | 10%=${b10.totalNetPct.toFixed(1)}% | 5%=${b5.totalNetPct.toFixed(1)}%`);
  }
  console.log(`Global: SL actual (${curS.totalNetPct.toFixed(1)}%) vs SL10 (${s10.totalNetPct.toFixed(1)}%) vs SL5 (${s5.totalNetPct.toFixed(1)}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
