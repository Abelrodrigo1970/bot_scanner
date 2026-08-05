/**
 * Scanner 2 Top 4 — Stoch RSI 5m
 * - Universo: top 4 do Scanner 2 (subidas 24h)
 * - Stoch RSI (RSI 50 / Stoch 50 / SmoothK 40 / SmoothD 11) em velas 5m
 * - %K cruza %D para cima → LONG (SL -5%)
 * - %K cruza %D para baixo → fecha posição LONG
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateStochasticRsiSeries, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const SCANNER2_STOCH_RSI_5M_STRATEGY_NAME = 'SCANNER2_STOCH_RSI_5M' as const;

export type Scanner2StochRsi5mParams = {
  topN?: number;
  chartTimeframe?: string;
  /** TradingView LengthRSI */
  rsiPeriod?: number;
  /** TradingView LengthStoch */
  stochPeriod?: number;
  /** TradingView SmoothK */
  smoothK?: number;
  /** TradingView SmoothD */
  smoothD?: number;
  stopLossPct?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  buyEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Scanner2StochRsi5mResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      longCreated: number;
      closed: number;
      executed: number;
      longSymbols: string[];
      closedSymbols: string[];
    };

function parseParams(raw: string | null): Scanner2StochRsi5mParams {
  try {
    return raw ? (JSON.parse(raw) as Scanner2StochRsi5mParams) : {};
  } catch {
    return {};
  }
}

async function closeLongPosition(
  strategyId: string,
  symbol: string,
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<boolean> {
  const pos = await inspectActivePositionForSymbol(symbol, exchange);
  let closed = false;
  if (pos.inspectable && pos.hasPosition) {
    const result = await closeActivePositionForSymbol(symbol, exchange, { rotationClose: true });
    closed = !!result.closed;
    if (result.closed) {
      console.log(`${logPrefix} 🔄 Fechado ${symbol} (Stoch K×D down): ${result.message}`);
    } else {
      console.warn(`${logPrefix} ⚠️ Falha ao fechar ${symbol}: ${result.message}`);
    }
  }

  await prisma.signal.updateMany({
    where: {
      strategyId,
      symbol,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    data: { status: 'EXPIRED' },
  });

  return closed;
}

export async function runScanner2StochRsi5mPipeline(options?: {
  logPrefix?: string;
}): Promise<Scanner2StochRsi5mResult> {
  const logPrefix = options?.logPrefix ?? '[Scanner2 Stoch RSI 5m]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER2_STOCH_RSI_5M_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia SCANNER2_STOCH_RSI_5M não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const topN = Math.max(1, Math.floor(Number(params.topN ?? 4)));
  const chartTimeframe = String(params.chartTimeframe ?? '5m');
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? 50)));
  const stochPeriod = Math.max(2, Math.floor(Number(params.stochPeriod ?? 50)));
  const smoothK = Math.max(1, Math.floor(Number(params.smoothK ?? 40)));
  const smoothD = Math.max(1, Math.floor(Number(params.smoothD ?? 11)));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.05));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;

  const ranked = await getTopRankedUniverseScanRows(
    UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H,
    topN
  );
  if (!ranked.ok) {
    return { status: 'skipped', reason: ranked.reason };
  }

  const topRows = ranked.rows;
  const topSymbols = new Set(topRows.map((r) => r.symbol));
  const rankBySymbol = new Map(topRows.map((r) => [r.symbol, r.rank]));

  const openLongs = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { symbol: true },
  });
  const openLongSet = new Set(openLongs.map((s) => s.symbol));

  const symbolsToCheck = new Set<string>([...topSymbols, ...openLongSet]);
  if (symbolsToCheck.size === 0) {
    return { status: 'skipped', reason: 'Sem símbolos no Top 4 nem posições abertas' };
  }

  const candlesNeeded = rsiPeriod + stochPeriod + smoothK + smoothD + 40;
  const startedAt = new Date();
  let longCreated = 0;
  let closedCount = 0;
  const longSymbols: string[] = [];
  const closedSymbols: string[] = [];

  for (const symbol of symbolsToCheck) {
    let candles;
    try {
      candles = await fetchCandles(symbol, chartTimeframe, candlesNeeded);
    } catch (e) {
      console.warn(
        `${logPrefix} Candles falhou ${symbol}: ${e instanceof Error ? e.message : e}`
      );
      continue;
    }
    if (!candles || candles.length < candlesNeeded - 20) continue;

    const closedCloses = getCloses(candles).slice(0, -1);
    const series = calculateStochasticRsiSeries(closedCloses, {
      rsiPeriod,
      stochasticPeriod: stochPeriod,
      kPeriod: smoothK,
      dPeriod: smoothD,
    });
    if (series.length < 2) continue;

    const prev = series[series.length - 2];
    const now = series[series.length - 1];
    const entryPrice = candles[candles.length - 2]?.close;
    if (!(entryPrice > 0)) continue;

    const crossUp = prev.k <= prev.d && now.k > now.d;
    const crossDown = prev.k >= prev.d && now.k < now.d;
    const inTop = topSymbols.has(symbol);
    const hasOpenLong = openLongSet.has(symbol);
    const rank = rankBySymbol.get(symbol);

    if (crossDown && hasOpenLong) {
      await closeLongPosition(strategy.id, symbol, exchange, logPrefix);
      closedCount++;
      closedSymbols.push(symbol);
      openLongSet.delete(symbol);
      console.log(
        `${logPrefix} ⏹️ EXIT ${symbol} Stoch K×D down (K ${now.k.toFixed(1)} < D ${now.d.toFixed(1)})`
      );
      continue;
    }

    if (!allowBuy || !crossUp || !inTop || hasOpenLong) continue;

    const openSame = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        direction: 'BUY',
        status: { in: ['NEW', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (openSame) continue;

    const stopLoss = entryPrice * (1 - stopLossPct);

    console.log(
      `${logPrefix} 🟢 LONG ${symbol} @ ${entryPrice} (rank #${rank ?? '?'} Stoch K×D up, SL -${(stopLossPct * 100).toFixed(0)}%)`
    );

    await prisma.signal.create({
      data: {
        symbol,
        direction: 'BUY',
        timeframe: chartTimeframe,
        strategyId: strategy.id,
        strategyName: strategy.displayName,
        entryPrice,
        stopLoss,
        target1: null,
        target2: null,
        target3: null,
        strength: Math.min(
          95,
          Math.max(80, Math.round(80 + Math.min(15, (now.k - now.d) / 2)))
        ),
        status: 'NEW',
        extraInfo: JSON.stringify({
          setup: 'scanner2_stoch_rsi_5m_long',
          scannerRank: rank ?? null,
          scanRunId: ranked.runId,
          scannedAt: ranked.scannedAt.toISOString(),
          k: Number(now.k.toFixed(2)),
          d: Number(now.d.toFixed(2)),
          kPrev: Number(prev.k.toFixed(2)),
          dPrev: Number(prev.d.toFixed(2)),
          rsiPeriod,
          stochPeriod,
          smoothK,
          smoothD,
          stopLossPct,
          chartTimeframe,
          crossover: `Stoch RSI %K cruza acima de %D (BUY)`,
          executionProfile: `LONG ${chartTimeframe} Top ${topN} Scanner 2 | StochRSI(${rsiPeriod},${stochPeriod},${smoothK},${smoothD}) K×D up | SL -${(stopLossPct * 100).toFixed(0)}% | fecha se K×D down`,
        }),
      },
    });

    longCreated++;
    longSymbols.push(symbol);
    openLongSet.add(symbol);
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 80);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: LONG ${longCreated} | fechados ${closedCount} | auto-exec ${executed}`
  );

  return {
    status: 'done',
    longCreated,
    closed: closedCount,
    executed,
    longSymbols,
    closedSymbols,
  };
}
