/**
 * engolfo — SELL 15m no Scanner 2
 * EMA12 < EMA21 + fecho da vela 15m ≥1% abaixo do fecho anterior.
 * SL +10% | TP1 −20% (50% pos.) | restante às 24h.
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import { calculateLastEMA, calculateSMA, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const ENGOLFO_15M_STRATEGY_NAME = 'ENGOLFO_15M' as const;

export type Engolfo15mParams = {
  universeTopN?: number;
  chartTimeframe?: string;
  maFastPeriod?: number;
  maSlowPeriod?: number;
  maType?: 'EMA' | 'SMA';
  /** Queda mínima do fecho vs fecho anterior (%). */
  minDropPct?: number;
  /** Exige vela bear (fecho < abertura). */
  requireBearCandle?: boolean;
  /** Exige preço abaixo da MA lenta. */
  requireCloseBelowSlowMa?: boolean;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  closeAfterHours?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Engolfo15mResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Engolfo15mParams {
  try {
    return raw ? (JSON.parse(raw) as Engolfo15mParams) : {};
  } catch {
    return {};
  }
}

function maAt(closes: number[], period: number, maType: 'EMA' | 'SMA'): number | null {
  return maType === 'SMA' ? calculateSMA(closes, period) : calculateLastEMA(closes, period);
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

/**
 * Detecta SELL engolfo numa série 15m (última vela fechada).
 */
export function detectEngolfo15mSell(
  candles: Candle[],
  params: Engolfo15mParams
): {
  entryPrice: number;
  stopLoss: number;
  target1: number;
  strength: number;
  dropPct: number;
  maFast: number;
  maSlow: number;
  barCloseTs: number;
  extraInfo: string;
} | null {
  const maFastPeriod = Math.max(2, Math.floor(Number(params.maFastPeriod ?? 12)));
  const maSlowPeriod = Math.max(maFastPeriod + 1, Math.floor(Number(params.maSlowPeriod ?? 21)));
  const maType: 'EMA' | 'SMA' = params.maType === 'SMA' ? 'SMA' : 'EMA';
  const minDropPct = Math.max(0.1, Number(params.minDropPct ?? 1));
  const requireBearCandle = params.requireBearCandle !== false;
  const requireCloseBelowSlowMa = params.requireCloseBelowSlowMa !== false;
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.1));
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? 0.2));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));

  if (candles.length < maSlowPeriod + 5) return null;

  // Exclui vela em formação
  const closed = candles.slice(0, -1);
  if (closed.length < maSlowPeriod + 2) return null;

  const lc = closed.length - 1;
  const prev = closed[lc - 1];
  const curr = closed[lc];
  if (!(prev.close > 0) || !(curr.close > 0)) return null;

  const dropPct = ((prev.close - curr.close) / prev.close) * 100;
  if (!(dropPct >= minDropPct)) return null;

  if (requireBearCandle && !(curr.close < curr.open)) return null;

  const closes = getCloses(closed);
  const maFast = maAt(closes, maFastPeriod, maType);
  const maSlow = maAt(closes, maSlowPeriod, maType);
  if (maFast == null || maSlow == null || !(maSlow > 0)) return null;

  // Stack bearish: MA rápida abaixo da lenta
  if (!(maFast < maSlow)) return null;
  if (requireCloseBelowSlowMa && !(curr.close < maSlow)) return null;

  const entryPrice = curr.close;
  const stopLoss = entryPrice * (1 + stopLossPct);
  const target1 = entryPrice * (1 - tp1Pct);
  if (!(stopLoss > entryPrice) || !(target1 < entryPrice)) return null;

  const strength = Math.min(
    95,
    Math.max(70, Math.round(72 + Math.min(18, (dropPct - minDropPct) * 4)))
  );

  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
  const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;

  return {
    entryPrice,
    stopLoss,
    target1,
    strength,
    dropPct: +dropPct.toFixed(3),
    maFast,
    maSlow,
    barCloseTs: curr.timestamp,
    extraInfo: JSON.stringify({
      setup: 'engolfo_15m',
      maFastPeriod,
      maSlowPeriod,
      maType,
      maFast: Number(maFast.toFixed(6)),
      maSlow: Number(maSlow.toFixed(6)),
      dropPct: +dropPct.toFixed(3),
      prevClose: prev.close,
      minDropPct,
      stopLossPct,
      tp1Pct,
      tp1Position,
      closeAfterHours,
      barCloseTs: curr.timestamp,
      executionProfile: `SELL | engolfo 15m (EMA${maFastPeriod}<EMA${maSlowPeriod}, fecho −${minDropPct}%+ vs ant.) | SL +${slLabel} | TP1 -${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
    }),
  };
}

/**
 * Cron 15m: Scanner 2 → engolfo SELL + fecho timed 24h.
 */
export async function runEngolfo15mPipeline(options?: {
  logPrefix?: string;
}): Promise<Engolfo15mResult> {
  const logPrefix = options?.logPrefix ?? '[engolfo]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: ENGOLFO_15M_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia ENGOLFO_15M não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  if (params.allowSell === false || params.sellEnabled === false) {
    return { status: 'skipped', reason: 'SELL desactivado nos params' };
  }

  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 30)));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const maSlowPeriod = Math.max(2, Math.floor(Number(params.maSlowPeriod ?? 21)));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Math.max(60, Math.floor(Number(params.autoExecuteMinStrength ?? 70)));

  const symbols = await resolveUniverseScanSymbolsTopN(
    UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H,
    topN
  );
  if (symbols.length === 0) {
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
  const candleLimit = Math.min(500, Math.max(maSlowPeriod + 40, 80));

  console.log(`${logPrefix} Scanner 2 top ${topN}: ${symbols.length} símbolos…`);

  for (const symbol of symbols) {
    const existingOpen = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        status: { in: ['NEW', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (existingOpen) {
      continue;
    }

    let candles;
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '15m', candleLimit);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }

    const hit = detectEngolfo15mSell(candles, params);
    if (!hit) continue;

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
      `${logPrefix} 🔴 SELL ${symbol} @ ${hit.entryPrice} (drop ${hit.dropPct}% | MA12/21 bear | SL +10% | TP1 −20% 50%)`
    );

    await prisma.signal.create({
      data: {
        symbol,
        direction: 'SELL',
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
    `${logPrefix} Concluído: ${signalsCreated} sinais, ${executed} exec, ${timedClosed} fechos 24h`
  );

  return {
    status: 'done',
    timedClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
  };
}
