/**
 * stch15long — Scanner 2 Top 2 · Stochastic clássico 15m LONG-only
 * - Cron 5m; só actua em velas 15m fechadas
 * - TV: %K Length 20 / %K Smoothing 15 / %D Smoothing 11
 * - %K cruza %D para cima → LONG (SL −5%)
 * - %K cruza %D para baixo → fecha LONG
 * - Sem SHORT / sem TP
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateStochasticSeries } from './indicators';
import { UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const STCH15LONG_STRATEGY_NAME = 'STCH15LONG' as const;

export type Stch15LongParams = {
  topN?: number;
  chartTimeframe?: string;
  /** TradingView %K Length */
  kLength?: number;
  /** TradingView %K Smoothing */
  kSmoothing?: number;
  /** TradingView %D Smoothing */
  dSmoothing?: number;
  /** SL LONG (fracção, ex. 0.05 = 5%). */
  stopLossPct?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Stch15LongResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      longCreated: number;
      closed: number;
      executed: number;
      longSymbols: string[];
      closedSymbols: string[];
    };

function parseParams(raw: string | null): Stch15LongParams {
  try {
    return raw ? (JSON.parse(raw) as Stch15LongParams) : {};
  } catch {
    return {};
  }
}

async function closeOpenLong(
  strategyId: string,
  symbol: string,
  exchange: 'binance' | 'bybit',
  logPrefix: string,
  reason: string
): Promise<boolean> {
  const pos = await inspectActivePositionForSymbol(symbol, exchange);
  let closed = false;
  if (pos.inspectable && pos.hasPosition) {
    const result = await closeActivePositionForSymbol(symbol, exchange, { rotationClose: true });
    closed = !!result.closed;
    if (result.closed) {
      console.log(`${logPrefix} 🔄 Fechado ${symbol} (${reason}): ${result.message}`);
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

export async function runStch15LongPipeline(options?: {
  logPrefix?: string;
}): Promise<Stch15LongResult> {
  const logPrefix = options?.logPrefix ?? '[stch15long]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: STCH15LONG_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia STCH15LONG não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const topN = Math.max(1, Math.min(2, Math.floor(Number(params.topN ?? 2))));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const kLength = Math.max(2, Math.floor(Number(params.kLength ?? 20)));
  const kSmoothing = Math.max(1, Math.floor(Number(params.kSmoothing ?? 15)));
  const dSmoothing = Math.max(1, Math.floor(Number(params.dSmoothing ?? 11)));
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
    return { status: 'skipped', reason: 'Sem símbolos no Top 2 nem LONGs abertos' };
  }

  const candlesNeeded = kLength + kSmoothing + dSmoothing + 40;
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

    // Wait for timeframe closes: ignora vela em formação
    const closed = candles.slice(0, -1);
    if (closed.length < kLength + kSmoothing + dSmoothing + 2) continue;

    const highs = closed.map((c) => c.high);
    const lows = closed.map((c) => c.low);
    const closes = closed.map((c) => c.close);
    const series = calculateStochasticSeries(highs, lows, closes, {
      kLength,
      kSmoothing,
      dSmoothing,
    });
    if (series.length < 2) continue;

    const prev = series[series.length - 2];
    const now = series[series.length - 1];
    if (!prev || !now) continue;

    const signalBar = closed[closed.length - 1];
    const entryPrice = signalBar.close;
    if (!(entryPrice > 0)) continue;

    const crossUp = prev.k <= prev.d && now.k > now.d;
    const crossDown = prev.k >= prev.d && now.k < now.d;
    const inTop = topSymbols.has(symbol);
    const hasOpenLong = openLongSet.has(symbol);
    const rank = rankBySymbol.get(symbol);

    if (crossDown && hasOpenLong) {
      await closeOpenLong(strategy.id, symbol, exchange, logPrefix, 'Stoch K×D down');
      closedCount++;
      closedSymbols.push(symbol);
      openLongSet.delete(symbol);
      console.log(
        `${logPrefix} ⏹️ EXIT LONG ${symbol} Stoch K×D down (K ${now.k.toFixed(1)} < D ${now.d.toFixed(1)})`
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

    const barCloseTs = signalBar.timestamp;
    const recentSameBar = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        generatedAt: { gte: new Date(Date.now() - 48 * 3600000) },
      },
      select: { id: true, extraInfo: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (recentSameBar?.extraInfo) {
      try {
        const ex = JSON.parse(recentSameBar.extraInfo) as { barCloseTs?: number };
        if (ex.barCloseTs === barCloseTs) {
          console.log(`${logPrefix} ⏭️ Cruzamento já sinalizado ${symbol} bar ${barCloseTs}`);
          continue;
        }
      } catch {
        /* ignore */
      }
    }

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
          setup: 'stch15long',
          scannerRank: rank ?? null,
          scanRunId: ranked.runId,
          scannedAt: ranked.scannedAt.toISOString(),
          barCloseTs,
          k: Number(now.k.toFixed(2)),
          d: Number(now.d.toFixed(2)),
          kPrev: Number(prev.k.toFixed(2)),
          dPrev: Number(prev.d.toFixed(2)),
          kLength,
          kSmoothing,
          dSmoothing,
          stopLossPct,
          chartTimeframe,
          topN,
          crossover: 'Stochastic %K cruza acima de %D (BUY)',
          executionProfile: `LONG Top ${topN} Scanner 2 | Stoch(${kLength},${kSmoothing},${dSmoothing}) ${chartTimeframe} K×D up | SL -${(stopLossPct * 100).toFixed(0)}% | fecha se K×D down | sem SHORT`,
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
