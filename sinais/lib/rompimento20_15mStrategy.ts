/**
 * Rompimento 20 (15m) — LONG no Scanner Lateral EMA21/70 (4h)
 * Fecho da última vela fechada acima do máximo das 20 velas anteriores.
 * Filtro: sem sinal se preço > 30% acima da EMA70.
 * SL −7% | TP1 +45% (50% pos.) | restante às 24h.
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import { calculateLastEMA, calculateSMA, getCloses } from './indicators';
import { UNIVERSE_CODE_LATERAL_VOLATILE } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const ROMPIMENTO_20_15M_STRATEGY_NAME = 'ROMPIMENTO_20_15M' as const;

export type Rompimento20_15mParams = {
  universeTopN?: number;
  chartTimeframe?: string;
  /** Nº de velas anteriores para o máximo (excluindo a vela de entrada). */
  breakoutLookback?: number;
  /** Exige vela bull (fecho > abertura). */
  requireBullishClose?: boolean;
  /** Período da média de filtro (distância ao preço). */
  filterMaPeriod?: number;
  filterMaType?: 'EMA' | 'SMA';
  /** Sem sinal se (fecho − MA)/MA × 100 > este % (acima da média). */
  maxDistAboveFilterMaPct?: number;
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

export type Rompimento20_15mResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Rompimento20_15mParams {
  try {
    return raw ? (JSON.parse(raw) as Rompimento20_15mParams) : {};
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

/**
 * Detecta LONG: fecho da última vela fechada > máximo das N velas anteriores.
 */
export function detectRompimento20_15mBuy(
  candles: Candle[],
  params: Rompimento20_15mParams
): {
  entryPrice: number;
  stopLoss: number;
  target1: number;
  strength: number;
  rangeHigh: number;
  breakoutPct: number;
  barCloseTs: number;
  extraInfo: string;
} | null {
  const lookback = Math.max(5, Math.floor(Number(params.breakoutLookback ?? 20)));
  const requireBullishClose = params.requireBullishClose === true;
  const filterMaPeriod = Math.max(2, Math.floor(Number(params.filterMaPeriod ?? 70)));
  const filterMaType: 'EMA' | 'SMA' = params.filterMaType === 'SMA' ? 'SMA' : 'EMA';
  const maxDistAboveFilterMaPct = Math.max(0, Number(params.maxDistAboveFilterMaPct ?? 30));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.07));
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? 0.45));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));

  const minBars = Math.max(lookback + 5, filterMaPeriod + 5);
  if (candles.length < minBars) return null;

  const closed = candles.slice(0, -1);
  if (closed.length < Math.max(lookback + 1, filterMaPeriod + 1)) return null;

  const curr = closed[closed.length - 1]!;
  if (!(curr.close > 0)) return null;
  if (requireBullishClose && !(curr.close > curr.open)) return null;

  const closes = getCloses(closed);
  const filterMa =
    filterMaType === 'SMA'
      ? calculateSMA(closes, filterMaPeriod)
      : calculateLastEMA(closes, filterMaPeriod);
  if (filterMa == null || !(filterMa > 0)) return null;

  const distAboveMaPct = ((curr.close - filterMa) / filterMa) * 100;
  if (distAboveMaPct > maxDistAboveFilterMaPct) return null;

  const rangeCandles = closed.slice(closed.length - 1 - lookback, closed.length - 1);
  if (rangeCandles.length < lookback) return null;

  const rangeHigh = Math.max(...rangeCandles.map((c) => c.high));
  if (!(rangeHigh > 0) || !(curr.close > rangeHigh)) return null;

  const entryPrice = curr.close;
  const stopLoss = entryPrice * (1 - stopLossPct);
  const target1 = entryPrice * (1 + tp1Pct);
  if (!(stopLoss < entryPrice) || !(target1 > entryPrice)) return null;

  const breakoutPct = ((curr.close - rangeHigh) / rangeHigh) * 100;
  const strength = Math.min(
    95,
    Math.max(70, Math.round(72 + Math.min(18, breakoutPct * 8)))
  );

  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
  const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;
  const maLabel = `${filterMaType}${filterMaPeriod}`;

  return {
    entryPrice,
    stopLoss,
    target1,
    strength,
    rangeHigh,
    breakoutPct: +breakoutPct.toFixed(3),
    barCloseTs: curr.timestamp,
    extraInfo: JSON.stringify({
      setup: 'rompimento_20_15m',
      breakoutLookback: lookback,
      rangeHigh: Number(rangeHigh.toFixed(8)),
      breakoutPct: +breakoutPct.toFixed(3),
      requireBullishClose,
      filterMaPeriod,
      filterMaType,
      filterMa: Number(filterMa.toFixed(8)),
      distAboveMaPct: +distAboveMaPct.toFixed(3),
      maxDistAboveFilterMaPct,
      stopLossPct,
      tp1Pct,
      tp1Position,
      closeAfterHours,
      barCloseTs: curr.timestamp,
      executionProfile: `BUY | rompimento 15m (fecho > máx. ${lookback} velas, dist ${maLabel} ≤${maxDistAboveFilterMaPct}%) | SL −${slLabel} | TP1 +${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
    }),
  };
}

/**
 * Cron 15m: Scanner Lateral → rompimento LONG + fecho timed 24h.
 */
export async function runRompimento20_15mPipeline(options?: {
  logPrefix?: string;
}): Promise<Rompimento20_15mResult> {
  const logPrefix = options?.logPrefix ?? '[rompimento20]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: ROMPIMENTO_20_15M_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia ROMPIMENTO_20_15M não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  if (params.allowBuy === false || params.buyEnabled === false) {
    return { status: 'skipped', reason: 'BUY desactivado nos params' };
  }

  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 80)));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const lookback = Math.max(5, Math.floor(Number(params.breakoutLookback ?? 20)));
  const filterMaPeriod = Math.max(2, Math.floor(Number(params.filterMaPeriod ?? 70)));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Math.max(60, Math.floor(Number(params.autoExecuteMinStrength ?? 70)));

  const symbols = await resolveUniverseScanSymbolsTopN(UNIVERSE_CODE_LATERAL_VOLATILE, topN);
  if (symbols.length === 0) {
    return {
      status: 'skipped',
      reason: 'Scanner Lateral vazio — correr run-lateral-volatile (00h/12h Lisboa)',
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
  const candleLimit = Math.min(500, Math.max(lookback + 40, filterMaPeriod + 40, 120));

  console.log(`${logPrefix} Lateral EMA21/70 top ${topN}: ${symbols.length} símbolos…`);

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

    let candles;
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '15m', candleLimit);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }

    const hit = detectRompimento20_15mBuy(candles, params);
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
      `${logPrefix} 🟢 BUY ${symbol} @ ${hit.entryPrice} (fecho > HH${lookback} | SL −7% | TP1 +45% 50%)`
    );

    await prisma.signal.create({
      data: {
        symbol,
        direction: 'BUY',
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
