/**
 * Pivot Boss: compara lucro bruto 24h vs SL/TP real do sinal (força ≥ 70).
 *
 * Uso: npx tsx scripts/analyze-pivot-boss-pnl-comparison.ts
 *      npx tsx scripts/analyze-pivot-boss-pnl-comparison.ts --minStrength=70 --from=2026-04-01
 */

import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const FEE = 0.1;
const NOTIONAL = 100;
const API = 'https://botcripto-production.up.railway.app/api/signals';

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
    minStrength: Number(get('--minStrength', '70')) || 70,
  };
}

function netRaw24h(s: SignalRow): number {
  return (s.result24h / s.entryPrice) * 100 - FEE;
}

/** SL fixo 8% / TP1 9% (50%) — perfil Pivot Boss. */
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

/** @deprecated alias — usa netSl8Tp9 */
function netFixedProfile(s: SignalRow): number {
  return netSl8Tp9(s);
}

function strengthBucket(strength: number): '70-74' | '75-80' | '81+' | null {
  if (strength >= 70 && strength <= 74) return '70-74';
  if (strength >= 75 && strength <= 80) return '75-80';
  if (strength >= 81) return '81+';
  return null;
}

const STRENGTH_BUCKETS = ['70-74', '75-80', '81+'] as const;

function printStrengthTable(title: string, rows: SignalRow[]) {
  console.log(`\n=== ${title} ===`);
  console.log(
    'Força'.padEnd(8) +
      'n'.padStart(5) +
      ' | ' +
      'Bruto 24h'.padEnd(22) +
      ' | ' +
      'SL 8% fixo'.padEnd(22) +
      ' | ' +
      'SL real sinal'.padEnd(22)
  );
  console.log('-'.repeat(95));

  for (const bucket of STRENGTH_BUCKETS) {
    const subset = rows.filter((s) => strengthBucket(s.strength) === bucket);
    if (!subset.length) {
      console.log(`${bucket.padEnd(8)}${'0'.padStart(5)} | (sem trades)`);
      continue;
    }
    const stRaw = stats(subset.map(netRaw24h));
    const stSl8 = stats(subset.map(netSl8Tp9));
    const stReal = stats(subset.map(netSignalSlTp));
    const cell = (st: ReturnType<typeof stats>) =>
      st
        ? `WR ${st.wr.toFixed(0)}% $${st.total.toFixed(0)} PF${st.pf === Infinity ? '∞' : st.pf.toFixed(1)}`
        : '—';
    console.log(
      `${bucket.padEnd(8)}${String(subset.length).padStart(5)} | ${cell(stRaw).padEnd(22)} | ${cell(stSl8).padEnd(22)} | ${cell(stReal).padEnd(22)}`
    );
  }

  const stRawAll = stats(rows.map(netRaw24h));
  const stSl8All = stats(rows.map(netSl8Tp9));
  const stRealAll = stats(rows.map(netSignalSlTp));
  console.log('-'.repeat(95));
  const cell = (st: ReturnType<typeof stats>) =>
    st
      ? `WR ${st.wr.toFixed(0)}% $${st.total.toFixed(0)} PF${st.pf === Infinity ? '∞' : st.pf.toFixed(1)}`
      : '—';
  console.log(
    `${'TOTAL'.padEnd(8)}${String(rows.length).padStart(5)} | ${cell(stRawAll).padEnd(22)} | ${cell(stSl8All).padEnd(22)} | ${cell(stRealAll).padEnd(22)}`
  );
}

function netSignalSlTp(s: SignalRow): number {
  const side = getSimulationSideForSignal(s.strategyName, s.direction);
  if (!side) return netRaw24h(s);
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
    totalUsd: (total / 100) * NOTIONAL * nets.length / nets.length, // total % * $100 per trade
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
  };
}

function fmt(label: string, st: ReturnType<typeof stats>) {
  if (!st) return `${label}: sem trades`;
  const usd = (st.total / 100) * NOTIONAL * st.n / (st.n ? 1 : 1);
  // total is sum of % per trade; on $100 each, USD = sum(netPct/100 * 100) = sum(netPct)
  const totalUsd = netsToUsd(st.total, st.n);
  return (
    `${label}: n=${st.n} | WR=${st.wr.toFixed(1)}% | liq=${st.total.toFixed(1)}% (~$${totalUsd.toFixed(2)})` +
    ` | avg=${st.avg.toFixed(2)}% | PF=${st.pf === Infinity ? '∞' : st.pf.toFixed(2)}`
  );
}

function netsToUsd(sumPct: number, _n: number): number {
  // each netResult is % on $100 position => USD = sumPct (since 1% = $1 on $100)
  return sumPct;
}

async function main() {
  const { from, minStrength } = parseArgs();
  const url = `${API}?limit=5000&minStrength=${minStrength}&onlyClosed=true&dateFrom=${from}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`API HTTP ${res.status} — login pode ser necessário na app.`);
    process.exit(1);
  }
  const json = (await res.json()) as { signals?: SignalRow[] };
  const pivot = (json.signals ?? []).filter(
    (s) =>
      s.result24h != null &&
      s.strength >= minStrength &&
      /pivot boss bear/i.test(s.strategyName)
  );

  const byStrategy = new Map<string, SignalRow[]>();
  for (const s of pivot) {
    const k = s.strategyName;
    if (!byStrategy.has(k)) byStrategy.set(k, []);
    byStrategy.get(k)!.push(s);
  }

  console.log(`\n=== Pivot Boss — bruto 24h vs SL/TP (força ≥ ${minStrength}, desde ${from}) ===\n`);
  console.log(`Sinais fechados: ${pivot.length}\n`);

  if (!pivot.length) {
    console.log('Sem sinais. Verifica auth/API ou intervalo de datas.');
    return;
  }

  const rawNets = pivot.map(netRaw24h);
  const fixedNets = pivot.map(netSl8Tp9);
  const signalNets = pivot.map(netSignalSlTp);

  console.log('--- TODOS Pivot Boss ---');
  console.log(fmt('Fecho 24h bruto (sem SL/TP intraday)', stats(rawNets)));
  console.log(fmt('SL fixo 8% + TP1 9% (perfil antigo)', stats(fixedNets)));
  console.log(fmt('SL/TP reais do sinal (honesto)', stats(signalNets)));

  const deltaHonestVsRaw = stats(signalNets)!.total - stats(rawNets)!.total;
  const deltaHonestVsFixed = stats(signalNets)!.total - stats(fixedNets)!.total;
  console.log(
    `\nDiferença honesto vs bruto 24h: ${deltaHonestVsRaw >= 0 ? '+' : ''}${deltaHonestVsRaw.toFixed(1)}% (~$${deltaHonestVsRaw.toFixed(2)})`
  );
  console.log(
    `Diferença honesto vs SL fixo 8%: ${deltaHonestVsFixed >= 0 ? '+' : ''}${deltaHonestVsFixed.toFixed(1)}% (~$${deltaHonestVsFixed.toFixed(2)})`
  );

  let stoppedBySl = 0;
  let tp1Hit = 0;
  for (const s of pivot) {
    if (s.direction !== 'SELL') continue;
    if (s.high24h != null && s.stopLoss > 0 && s.high24h >= s.stopLoss) stoppedBySl++;
    if (s.low24h != null && s.target1 != null && s.low24h <= s.target1) tp1Hit++;
  }
  const sells = pivot.filter((s) => s.direction === 'SELL');
  console.log(
    `\nSELL com high24h ≥ SL real: ${stoppedBySl}/${sells.length} (${((stoppedBySl / sells.length) * 100).toFixed(0)}%)`
  );
  console.log(
    `SELL com low24h ≤ TP1 real: ${tp1Hit}/${sells.length} (${((tp1Hit / sells.length) * 100).toFixed(0)}%)`
  );

  for (const [name, rows] of byStrategy.entries()) {
    console.log(`\n--- ${name} (${rows.length}) ---`);
    console.log(fmt('  Fecho 24h bruto', stats(rows.map(netRaw24h))));
    console.log(fmt('  SL fixo 8%', stats(rows.map(netSl8Tp9))));
    console.log(fmt('  SL/TP do sinal', stats(rows.map(netSignalSlTp))));
  }

  const pivot15m = pivot.filter((s) => /15m/i.test(s.strategyName));
  printStrengthTable('Pivot Boss 15m — por força (SL 8% / TP1 9% / SL real)', pivot15m);
  printStrengthTable('Todos Pivot Boss — por força', pivot);

  const divergent = pivot
    .map((s) => ({
      s,
      raw: netRaw24h(s),
      honest: netSignalSlTp(s),
      diff: netSignalSlTp(s) - netRaw24h(s),
    }))
    .filter((r) => Math.abs(r.diff) > 3)
    .sort((a, b) => a.diff - b.diff);

  if (divergent.length) {
    console.log(`\n--- Maiores divergências (bruto vs honesto, top 10 piores) ---`);
    for (const r of divergent.slice(0, 10)) {
      const slPct = ((r.s.stopLoss - r.s.entryPrice) / r.s.entryPrice) * 100;
      console.log(
        `  ${r.s.symbol.padEnd(12)} f=${r.s.strength} | bruto ${r.raw >= 0 ? '+' : ''}${r.raw.toFixed(1)}% → honesto ${r.honest >= 0 ? '+' : ''}${r.honest.toFixed(1)}% | SL +${slPct.toFixed(1)}%`
      );
    }
  }

  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
