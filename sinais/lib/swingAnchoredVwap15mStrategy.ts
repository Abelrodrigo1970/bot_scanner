/**
 * Swing Anchored VWAP 15m — BigBeluga-style trend flip no Scanner 2.
 * BUY: novo máximo lookback + trend bullish. SELL: novo mínimo + trend bearish.
 */

import { prisma } from './db';
import { dropFormingCandle, fetchCandles } from './marketData';
import { UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H } from './symbolUniverseDefaults';
import {
  ensureAllBuiltinUniverseScans,
  resolveUniverseScanSymbolsTopN,
} from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';
import {
  detectSwingAnchoredVwapSignal,
  type SwingAnchoredVwapParams,
} from './swingAnchoredVwapDetector';

export const SWING_ANCHORED_VWAP_15M_STRATEGY_NAME = 'SWING_ANCHORED_VWAP_15M' as const;

export type SwingAnchoredVwap15mParams = SwingAnchoredVwapParams & {
  universeTopN?: number;
  chartTimeframe?: string;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type SwingAnchoredVwap15mResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): SwingAnchoredVwap15mParams {
  try {
    return raw ? (JSON.parse(raw) as SwingAnchoredVwap15mParams) : {};
  } catch {
    return {};
  }
}

async function closeTimedOutPositions(
  strategyId: string,
  defaultCloseHours: number,
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<number> {
  const openSignals = await prisma.signal.findMany({
    where: { strategyId, status: 'IN_PROGRESS' },
    select: { id: true, symbol: true, generatedAt: true, extraInfo: true },
    orderBy: { generatedAt: 'asc' },
  });

  const now = Date.now();
  let closed = 0;

  for (const sig of openSignals) {
    let closeHours = defaultCloseHours;
    try {
      const extra = sig.extraInfo ? (JSON.parse(sig.extraInfo) as Record<string, unknown>) : {};
      if (extra.closeAfterHours != null) closeHours = Number(extra.closeAfterHours);
    } catch {
      /* keep default */
    }

    const ageMs = now - sig.generatedAt.getTime();
    if (ageMs < closeHours * 3600000) continue;

    const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);
    if (pos.inspectable && pos.hasPosition) {
      const result = await closeActivePositionForSymbol(sig.symbol, exchange, { timedClose: true });
      if (result.closed) {
        closed++;
        console.log(`${logPrefix} ⏱️ Fechado ${sig.symbol} após ${closeHours}h: ${result.message}`);
      } else {
        console.warn(`${logPrefix} ⚠️ Falha fecho ${closeHours}h ${sig.symbol}: ${result.message}`);
      }
    }

    await prisma.signal.update({ where: { id: sig.id }, data: { status: 'EXPIRED' } });
  }

  return closed;
}

function detectorParamsFrom(p: SwingAnchoredVwap15mParams): SwingAnchoredVwapParams {
  return {
    lookbackLength: p.lookbackLength,
    stopLossPct: p.stopLossPct,
    slSwingBufferPct: p.slSwingBufferPct,
    useSwingLevelSl: p.useSwingLevelSl,
    tp1Pct: p.tp1Pct,
    tp1Position: p.tp1Position,
    closeAfterHours: p.closeAfterHours,
  };
}

export async function runSwingAnchoredVwap15mPipeline(options?: {
  logPrefix?: string;
}): Promise<SwingAnchoredVwap15mResult> {
  const logPrefix = options?.logPrefix ?? '[swing-vwap]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SWING_ANCHORED_VWAP_15M_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia SWING_ANCHORED_VWAP_15M não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const allowBuy = params.allowBuy !== false && params.buyEnabled !== false;
  const allowSell = params.allowSell !== false && params.sellEnabled !== false;
  if (!allowBuy && !allowSell) {
    return { status: 'skipped', reason: 'BUY e SELL desactivados nos params' };
  }

  await ensureAllBuiltinUniverseScans('swing-anchored-vwap-15m');

  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 15)));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const lookback = Math.max(5, Math.floor(Number(params.lookbackLength ?? 50)));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Math.max(55, Math.floor(Number(params.autoExecuteMinStrength ?? 70)));
  const detectorParams = detectorParamsFrom(params);

  const symbols = await resolveUniverseScanSymbolsTopN(
    UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H,
    topN
  );
  if (symbols.length === 0) {
    console.warn(`${logPrefix} Scanner 2 vazio após resolve top ${topN}`);
    return {
      status: 'skipped',
      reason: 'Scanner 2 vazio — correr run-universe-scans',
    };
  }

  const timedClosed = await closeTimedOutPositions(
    strategy.id,
    closeAfterHours,
    exchange,
    logPrefix
  );

  const startedAt = new Date();
  let signalsCreated = 0;
  const hitSymbols: string[] = [];
  const candleLimit = Math.min(500, lookback + 80);

  console.log(`${logPrefix} Scanner 2 top ${topN}: ${symbols.length} símbolos (length ${lookback})…`);

  for (const symbol of symbols) {
    const existingOpen = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        status: { in: ['NEW', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (existingOpen) continue;

    let rawCandles;
    try {
      rawCandles = await fetchCandles(symbol, chartTimeframe as '15m', candleLimit);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }

    const candles = dropFormingCandle(rawCandles, '15m');
    const hit = detectSwingAnchoredVwapSignal(candles, detectorParams);
    if (!hit) continue;

    if (hit.direction === 'BUY' && !allowBuy) continue;
    if (hit.direction === 'SELL' && !allowSell) continue;

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
        if (ex.barCloseTs === hit.barCloseTs) continue;
      } catch {
        /* ignore */
      }
    }

    console.log(
      `${logPrefix} ${hit.direction === 'BUY' ? '🟢' : '🔴'} ${hit.direction} ${symbol} @ ${hit.entryPrice} (vwap ${hit.activeVwap.toFixed(6)} | swing ${hit.swingLevel.toFixed(6)})`
    );

    await prisma.signal.create({
      data: {
        symbol,
        direction: hit.direction,
        timeframe: chartTimeframe,
        strategyId: strategy.id,
        strategyName: strategy.displayName,
        entryPrice: hit.entryPrice,
        stopLoss: hit.stopLoss,
        target1: hit.target1,
        target2: null,
        target3: null,
        strength: hit.strength,
        status: 'NEW',
        extraInfo: hit.extraInfo,
      },
    });
    signalsCreated++;
    hitSymbols.push(symbol);
  }

  const executed = await autoExecuteNewSignalsForStrategy({
    strategy: { id: strategy.id, name: strategy.name, params: strategy.params },
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${signalsCreated} sinais, ${executed} exec, ${timedClosed} fechos ${closeAfterHours}h`
  );

  return {
    status: 'done',
    timedClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
  };
}
