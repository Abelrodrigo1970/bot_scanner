/**
 * Backtest walk-forward em velas — todas as estratégias activas desde 1 Abril.
 *
 * Uso: npx tsx scripts/backtest-btcusdt-candles.ts --symbol=BTCUSDT
 *      npx tsx scripts/backtest-btcusdt-candles.ts --symbol=ETHUSDT --from=2026-04-01
 */

import {
  clearBacktestCandlePools,
  fetchCandles,
  setBacktestCandlePools,
  setBacktestCursor,
  type Candle,
} from '../lib/marketData';
import {
  runMaCross15mStrategy,
  runMa60VolatileStrategy,
  runMa200VolatileStrategy,
  runEmaRibbonScalpingStrategy,
  runEmaRibbonScalpingSellStrategy,
  runPivotBossBear15mStrategy,
  runPivotBossBear1hStrategy,
  type SignalResult,
  type StrategyParams,
  type Timeframe,
} from '../lib/signalEngine';
import {
  runMacdHistogramPmoStrategy,
  runRsiOverboughtDrop1hStrategy,
  runAfastamentoMedioStrategy,
  runAfastamentoMedio30mStrategy,
} from '../lib/builtinImportedStrategies';
import {
  MA_CROSS_5M_PARAMS,
  MACD_HISTOGRAM_PMO_PARAMS,
  RSI_OVERBOUGHT_DROP_1H_PARAMS,
  PIVOT_BOSS_BEAR_15M_PARAMS,
  PIVOT_BOSS_BEAR_1H_PARAMS,
  AFASTAMENTO_MEDIO_BUY_PARAMS,
  AFASTAMENTO_MEDIO_SELL_PARAMS,
  AFASTAMENTO_MEDIO_EXIT_PARAMS,
  AFASTAMENTO_STRENGTH_FILTER_PARAMS,
  AFASTAMENTO_MEDIO_30M_BUY_PARAMS,
  AFASTAMENTO_MEDIO_30M_SELL_PARAMS,
  AFASTAMENTO_MEDIO_30M_EXIT_PARAMS,
} from '../lib/strategyMigrations';
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';

const FEE_PCT = 0.1;

const INTERVAL_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
};

type StrategyRunner = {
  label: string;
  timeframe: Timeframe;
  stepInterval: keyof typeof INTERVAL_MS;
  params: StrategyParams;
  minStrength: number;
  cooldownMs: number;
  run: (symbol: string, tf: Timeframe, params: StrategyParams) => Promise<SignalResult | null>;
};

const AFASTAMENTO_1H_PARAMS: StrategyParams = {
  ...AFASTAMENTO_MEDIO_BUY_PARAMS,
  ...AFASTAMENTO_MEDIO_SELL_PARAMS,
  ...AFASTAMENTO_MEDIO_EXIT_PARAMS,
  ...AFASTAMENTO_STRENGTH_FILTER_PARAMS,
  allowBuy: true,
  allowSell: true,
};

const AFASTAMENTO_30M_PARAMS: StrategyParams = {
  ...AFASTAMENTO_MEDIO_30M_BUY_PARAMS,
  ...AFASTAMENTO_MEDIO_30M_SELL_PARAMS,
  ...AFASTAMENTO_MEDIO_30M_EXIT_PARAMS,
  ...AFASTAMENTO_STRENGTH_FILTER_PARAMS,
  allowBuy: true,
  allowSell: true,
};

const STRATEGIES: StrategyRunner[] = [
  {
    label: 'MA Cross 15m (MA12/MA30)',
    timeframe: '15m',
    stepInterval: '15m',
    params: { ...MA_CROSS_5M_PARAMS },
    minStrength: 70,
    cooldownMs: 0,
    run: runMaCross15mStrategy,
  },
  {
    label: 'MA Cross Top Voláteis',
    timeframe: '1h',
    stepInterval: '1h',
    params: { allowBuy: true, allowSell: true },
    minStrength: 60,
    cooldownMs: 0,
    run: runMa60VolatileStrategy,
  },
  {
    label: 'MA200 Top Voláteis',
    timeframe: '4h',
    stepInterval: '4h',
    params: { allowBuy: true, allowSell: true },
    minStrength: 60,
    cooldownMs: 0,
    run: runMa200VolatileStrategy,
  },
  {
    label: 'EMA Ribbon Scalping (15m)',
    timeframe: '15m',
    stepInterval: '15m',
    params: { allowBuy: true, allowSell: false },
    minStrength: 60,
    cooldownMs: 0,
    run: runEmaRibbonScalpingStrategy,
  },
  {
    label: 'EMA Ribbon Scalping SELL (15m)',
    timeframe: '15m',
    stepInterval: '15m',
    params: { allowBuy: false, allowSell: true },
    minStrength: 60,
    cooldownMs: 0,
    run: runEmaRibbonScalpingSellStrategy,
  },
  {
    label: 'MACD Histogram 1h + PMO',
    timeframe: '1h',
    stepInterval: '1h',
    params: { ...MACD_HISTOGRAM_PMO_PARAMS },
    minStrength: 60,
    cooldownMs: 4 * 60 * 60 * 1000,
    run: runMacdHistogramPmoStrategy,
  },
  {
    label: 'Afastamento médio 1h (≤1,9→≥2,4)',
    timeframe: '1h',
    stepInterval: '1h',
    params: AFASTAMENTO_1H_PARAMS,
    minStrength: 60,
    cooldownMs: 0,
    run: runAfastamentoMedioStrategy,
  },
  {
    label: 'Afastamento médio 30m (≤2→≥2,3)',
    timeframe: '30m',
    stepInterval: '30m',
    params: AFASTAMENTO_30M_PARAMS,
    minStrength: 60,
    cooldownMs: 0,
    run: runAfastamentoMedio30mStrategy,
  },
  {
    label: 'RSI pullback bear 1h',
    timeframe: '1h',
    stepInterval: '1h',
    params: { ...RSI_OVERBOUGHT_DROP_1H_PARAMS, allowSell: true, allowBuy: false },
    minStrength: 60,
    cooldownMs: 0,
    run: runRsiOverboughtDrop1hStrategy,
  },
  {
    label: 'Pivot Boss Bear 15m (4 EMA venda)',
    timeframe: '15m',
    stepInterval: '15m',
    params: { ...PIVOT_BOSS_BEAR_15M_PARAMS, allowSell: true, allowBuy: false },
    minStrength: 60,
    cooldownMs: 0,
    run: runPivotBossBear15mStrategy,
  },
  {
    label: 'Pivot Boss Bear 1h (4 EMA venda)',
    timeframe: '1h',
    stepInterval: '1h',
    params: { ...PIVOT_BOSS_BEAR_1H_PARAMS, allowSell: true, allowBuy: false },
    minStrength: 60,
    cooldownMs: 0,
    run: runPivotBossBear1hStrategy,
  },
];

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    from: get('--from', '2026-04-01'),
    symbol: get('--symbol', 'BTCUSDT').toUpperCase(),
    minStrength: Number(get('--minStrength', '60')) || 60,
  };
}

async function loadCandlesRange(
  symbol: string,
  interval: string,
  fromMs: number,
  toMs: number
): Promise<Candle[]> {
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  const out: Candle[] = [];
  const seen = new Set<number>();
  let cursor = fromMs - step * 300;

  while (cursor < toMs) {
    const batch = await fetchCandles(symbol, interval, 1500, cursor);
    if (!batch.length) break;
    for (const c of batch) {
      if (c.timestamp < fromMs - step * 300 || c.timestamp > toMs) continue;
      if (seen.has(c.timestamp)) continue;
      seen.add(c.timestamp);
      out.push(c);
    }
    const last = batch[batch.length - 1]!.timestamp;
    if (last <= cursor) break;
    cursor = last + step;
    await new Promise((r) => setTimeout(r, 130));
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

function simulateSlTp(
  label: string,
  direction: 'BUY' | 'SELL',
  entry: number,
  high24: number,
  low24: number,
  price24: number
): number {
  const side = getSimulationSideForSignal(label, direction);
  if (!side) {
    const raw = direction === 'BUY' ? price24 - entry : entry - price24;
    return (raw / entry) * 100 - FEE_PCT;
  }

  const sl = side.stopLossPct;
  const tp1 = side.tp1Pct;
  const tp2 = side.tp2Pct;
  const tp1W = side.tp1PositionPct / 100;
  const tp2W = side.tp2PositionPct / 100;
  const finalW = Math.max(0, 1 - tp1W - tp2W);
  const base24 = ((direction === 'BUY' ? price24 - entry : entry - price24) / entry) * 100;

  if (direction === 'BUY') {
    const slPx = entry * (1 - sl / 100);
    const tp1Px = entry * (1 + tp1 / 100);
    const tp2Px = tp2 ? entry * (1 + tp2 / 100) : 0;
    if (low24 <= slPx) return -sl - FEE_PCT;
    if (tp2 && tp2W > 0 && high24 >= tp2Px) {
      return tp1W * tp1 + tp2W * tp2 + finalW * Math.max(base24, -sl) - FEE_PCT;
    }
    if (high24 >= tp1Px) {
      return tp1W * tp1 + (1 - tp1W) * Math.max(base24, -sl) - FEE_PCT;
    }
    return Math.max(base24, -sl) - FEE_PCT;
  }

  const slPx = entry * (1 + sl / 100);
  const tp1Px = entry * (1 - tp1 / 100);
  const tp2Px = tp2 ? entry * (1 - tp2 / 100) : 0;
  if (high24 >= slPx) return -sl - FEE_PCT;
  if (tp2 && tp2W > 0 && low24 <= tp2Px) {
    return tp1W * tp1 + tp2W * tp2 + finalW * Math.max(base24, -sl) - FEE_PCT;
  }
  if (low24 <= tp1Px) {
    return tp1W * tp1 + (1 - tp1W) * Math.max(base24, -sl) - FEE_PCT;
  }
  return Math.max(base24, -sl) - FEE_PCT;
}

function stats(nets: number[]) {
  if (!nets.length) return null;
  const wins = nets.filter((n) => n >= 0);
  const losses = nets.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  return {
    n: nets.length,
    wr: (wins.length / nets.length) * 100,
    total: nets.reduce((a, n) => a + n, 0),
    avg: nets.reduce((a, n) => a + n, 0) / nets.length,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
  };
}

function fmt(st: ReturnType<typeof stats>) {
  if (!st) return 'sem trades';
  return `n=${st.n} WR=${st.wr.toFixed(1)}% liq=${st.total.toFixed(2)}% avg=${st.avg.toFixed(2)}% PF=${st.pf === Infinity ? '∞' : st.pf.toFixed(2)}`;
}

async function main() {
  const { from, symbol, minStrength } = parseArgs();
  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const toMs = Date.now();
  const warmupMs = 30 * 24 * 60 * 60 * 1000;

  console.log(`\n=== BACKTEST VELAS ${symbol} desde ${from} ===`);
  console.log('A carregar histórico Binance Futures…');

  const pools = new Map<string, Candle[]>();
  for (const iv of ['15m', '30m', '1h', '4h'] as const) {
    const key = `${symbol}:${iv}`;
    pools.set(key, await loadCandlesRange(symbol, iv, fromMs - warmupMs, toMs));
    console.log(`  ${iv}: ${pools.get(key)!.length} velas`);
  }

  const candles1h = pools.get(`${symbol}:1h`)!;
  setBacktestCandlePools(pools);

  type TradeRow = {
    strategy: string;
    ts: number;
    direction: string;
    strength: number;
    entry: number;
    pnl: number;
  };

  const allTrades: TradeRow[] = [];
  const summary: { label: string; nets: number[] }[] = [];

  for (const strat of STRATEGIES) {
    const stepKey = `${symbol}:${strat.stepInterval}`;
    const stepCandles = pools.get(stepKey) ?? [];
    const stepMs = INTERVAL_MS[strat.stepInterval]!;
    const minStrengthEff = Math.max(minStrength, strat.minStrength);

    const nets: number[] = [];
    const trades: TradeRow[] = [];
    let lastSignalMs = 0;
    let lastDir = '';

    const startIdx = stepCandles.findIndex((c) => c.timestamp >= fromMs);
    if (startIdx < 0) {
      summary.push({ label: strat.label, nets });
      continue;
    }

    for (let i = startIdx; i < stepCandles.length - 1; i++) {
      const bar = stepCandles[i]!;
      const barEnd = bar.timestamp + stepMs;
      if (barEnd + 24 * 60 * 60 * 1000 > toMs) break;

      setBacktestCursor(barEnd);

      let signal: SignalResult | null = null;
      try {
        signal = await strat.run(symbol, strat.timeframe, strat.params);
      } catch {
        signal = null;
      }

      if (!signal || signal.strength < minStrengthEff) continue;
      if (
        strat.cooldownMs > 0 &&
        lastSignalMs > 0 &&
        barEnd - lastSignalMs < strat.cooldownMs &&
        lastDir === signal.direction
      ) {
        continue;
      }

      const forward = candles1h.filter(
        (c) => c.timestamp > barEnd && c.timestamp <= barEnd + 24 * 60 * 60 * 1000
      );
      if (!forward.length) continue;

      const high24 = Math.max(signal.entryPrice, ...forward.map((c) => c.high));
      const low24 = Math.min(signal.entryPrice, ...forward.map((c) => c.low));
      const price24 = forward[forward.length - 1]!.close;
      const pnl = simulateSlTp(
        strat.label,
        signal.direction,
        signal.entryPrice,
        high24,
        low24,
        price24
      );

      nets.push(pnl);
      trades.push({
        strategy: strat.label,
        ts: barEnd,
        direction: signal.direction,
        strength: signal.strength,
        entry: signal.entryPrice,
        pnl,
      });
      lastSignalMs = barEnd;
      lastDir = signal.direction;
    }

    summary.push({ label: strat.label, nets });
    allTrades.push(...trades);
    console.log(`\n${strat.label}`);
    console.log(`  ${fmt(stats(nets))}`);
    for (const t of trades) {
      console.log(
        `  ${new Date(t.ts).toISOString().slice(0, 16)} | ${t.direction.padEnd(4)} | f=${String(t.strength).padStart(2)} | entry ${t.entry.toFixed(1)} | ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}%`
      );
    }
  }

  clearBacktestCandlePools();

  const totalNets = allTrades.map((t) => t.pnl);
  console.log('\n--- TOTAL (todas as estratégias, sem deduplicar overlaps) ---');
  console.log(fmt(stats(totalNets)));
  console.log(
    `\nNota: backtest em ${symbol} ignora filtros de universo (Scanner 1/2/3). Sinais reais do bot neste par são raros.`
  );
}

main().catch((e) => {
  clearBacktestCandlePools();
  console.error(e);
  process.exit(1);
});
