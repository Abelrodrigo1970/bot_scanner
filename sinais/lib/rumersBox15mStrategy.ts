/**
 * Rumer's Box (15m) — níveis do dia anterior (The Rumer's Box / PDH-PDL).
 * prevHigh / prevLow / prevMid da última vela diária fechada.
 * LONG: fecho 15m cruza acima de prevHigh.
 * SHORT: fecho 15m cruza abaixo de prevLow.
 * TP1 = 1× altura da caixa (measured move); SL % fixo; restante às N h.
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RUMERS_BOX_15M_STRATEGY_NAME = 'RUMERS_BOX_15M' as const;

export type RumersBox15mParams = {
  universeTopN?: number;
  chartTimeframe?: string;
  dailyTimeframe?: string;
  /** Exige que a vela 15m anterior estivesse dentro da caixa (ou no lado correcto). */
  requireInsideBeforeBreak?: boolean;
  /** Largura mínima da caixa: (high−low)/mid × 100. */
  minBoxRangePct?: number;
  /** Largura máxima da caixa (%). */
  maxBoxRangePct?: number;
  stopLossPct?: number;
  /** Fallback de TP1 em % se a caixa for demasiado estreita. */
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

export type RumersBox15mResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

export type RumersBoxLevels = {
  prevHigh: number;
  prevLow: number;
  prevMid: number;
  boxHeight: number;
  boxRangePct: number;
  dayKey: string;
  dailyBarTs: number;
};

export type RumersBoxHit = {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  strength: number;
  barCloseTs: number;
  levels: RumersBoxLevels;
  extraInfo: string;
};

function parseParams(raw: string | null): RumersBox15mParams {
  try {
    return raw ? (JSON.parse(raw) as RumersBox15mParams) : {};
  } catch {
    return {};
  }
}

function utcDayKey(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

/**
 * Níveis da última vela diária fechada (equivalente a high[1]/low[1] no Pine D).
 */
export function computePrevDayLevels(dailyCandles: Candle[]): RumersBoxLevels | null {
  if (dailyCandles.length < 2) return null;
  const closed = dailyCandles.slice(0, -1);
  if (closed.length < 1) return null;
  const prev = closed[closed.length - 1]!;
  if (!(prev.high > 0) || !(prev.low > 0) || !(prev.high >= prev.low)) return null;

  const prevHigh = prev.high;
  const prevLow = prev.low;
  const prevMid = (prevHigh + prevLow) / 2;
  const boxHeight = prevHigh - prevLow;
  if (!(boxHeight > 0) || !(prevMid > 0)) return null;

  const boxRangePct = (boxHeight / prevMid) * 100;

  return {
    prevHigh,
    prevLow,
    prevMid,
    boxHeight,
    boxRangePct,
    dayKey: utcDayKey(prev.timestamp),
    dailyBarTs: prev.timestamp,
  };
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
 * Detecta cruzamento do PDH (BUY) ou PDL (SELL) na última vela 15m fechada.
 */
export function detectRumersBox15m(
  candles15m: Candle[],
  levels: RumersBoxLevels,
  params: RumersBox15mParams
): RumersBoxHit | null {
  const requireInsideBeforeBreak = params.requireInsideBeforeBreak !== false;
  const minBoxRangePct = Math.max(0, Number(params.minBoxRangePct ?? 0.8));
  const maxBoxRangePct = Math.max(minBoxRangePct, Number(params.maxBoxRangePct ?? 12));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.05));
  const tp1Pct = Math.max(0.005, Number(params.tp1Pct ?? 0.06));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const allowBuy = !(params.allowBuy === false || params.buyEnabled === false);
  const allowSell = !(params.allowSell === false || params.sellEnabled === false);

  if (levels.boxRangePct < minBoxRangePct || levels.boxRangePct > maxBoxRangePct) return null;

  const closed = candles15m.slice(0, -1);
  if (closed.length < 2) return null;

  const curr = closed[closed.length - 1]!;
  const prevBar = closed[closed.length - 2]!;
  if (!(curr.close > 0) || !(prevBar.close > 0)) return null;

  const { prevHigh, prevLow, prevMid, boxHeight } = levels;

  let direction: 'BUY' | 'SELL' | null = null;

  if (allowBuy && curr.close > prevHigh && prevBar.close <= prevHigh) {
    if (!requireInsideBeforeBreak || (prevBar.close >= prevLow && prevBar.close <= prevHigh)) {
      direction = 'BUY';
    }
  } else if (allowSell && curr.close < prevLow && prevBar.close >= prevLow) {
    if (!requireInsideBeforeBreak || (prevBar.close >= prevLow && prevBar.close <= prevHigh)) {
      direction = 'SELL';
    }
  }

  if (!direction) return null;

  const entryPrice = curr.close;
  let stopLoss: number;
  let target1: number;
  const measured = boxHeight;

  if (direction === 'BUY') {
    stopLoss = entryPrice * (1 - stopLossPct);
    const measuredTp = entryPrice + measured;
    const pctTp = entryPrice * (1 + tp1Pct);
    target1 = Math.max(measuredTp, pctTp);
    if (!(stopLoss < entryPrice) || !(target1 > entryPrice)) return null;
  } else {
    stopLoss = entryPrice * (1 + stopLossPct);
    const measuredTp = entryPrice - measured;
    const pctTp = entryPrice * (1 - tp1Pct);
    target1 = Math.min(measuredTp, pctTp);
    if (!(stopLoss > entryPrice) || !(target1 < entryPrice)) return null;
  }

  const breakPct =
    direction === 'BUY'
      ? ((curr.close - prevHigh) / prevHigh) * 100
      : ((prevLow - curr.close) / prevLow) * 100;

  const strength = Math.min(95, Math.max(70, Math.round(72 + Math.min(18, breakPct * 10))));

  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
  const profile =
    direction === 'BUY'
      ? `BUY | Rumer's Box 15m (cruzamento PDH ${levels.dayKey}) | caixa ${(levels.boxRangePct).toFixed(2)}% | SL −${slLabel} | TP1 1×range | restante ${closeAfterHours}h`
      : `SELL | Rumer's Box 15m (cruzamento PDL ${levels.dayKey}) | caixa ${(levels.boxRangePct).toFixed(2)}% | SL +${slLabel} | TP1 1×range | restante ${closeAfterHours}h`;

  return {
    direction,
    entryPrice,
    stopLoss,
    target1,
    strength,
    barCloseTs: curr.timestamp,
    levels,
    extraInfo: JSON.stringify({
      setup: 'rumers_box_15m',
      dayKey: levels.dayKey,
      dailyBarTs: levels.dailyBarTs,
      prevHigh: Number(prevHigh.toFixed(8)),
      prevLow: Number(prevLow.toFixed(8)),
      prevMid: Number(prevMid.toFixed(8)),
      boxHeight: Number(boxHeight.toFixed(8)),
      boxRangePct: +levels.boxRangePct.toFixed(3),
      breakPct: +breakPct.toFixed(3),
      requireInsideBeforeBreak,
      minBoxRangePct,
      maxBoxRangePct,
      stopLossPct,
      tp1Pct,
      tp1Position,
      closeAfterHours,
      barCloseTs: curr.timestamp,
      executionProfile: profile,
    }),
  };
}

/**
 * Cron 15m: Scanner 1 → Rumer's Box LONG/SHORT + fecho timed.
 */
export async function runRumersBox15mPipeline(options?: {
  logPrefix?: string;
}): Promise<RumersBox15mResult> {
  const logPrefix = options?.logPrefix ?? '[rumers-box]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: RUMERS_BOX_15M_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia RUMERS_BOX_15M não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const allowBuy = !(params.allowBuy === false || params.buyEnabled === false);
  const allowSell = !(params.allowSell === false || params.sellEnabled === false);
  if (!allowBuy && !allowSell) {
    return { status: 'skipped', reason: 'BUY e SELL desactivados nos params' };
  }

  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 20)));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const dailyTimeframe = String(params.dailyTimeframe ?? '1d');
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Math.max(60, Math.floor(Number(params.autoExecuteMinStrength ?? 70)));

  const symbols = await resolveUniverseScanSymbolsTopN(UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D, topN);
  if (symbols.length === 0) {
    return {
      status: 'skipped',
      reason: 'Scanner 1 vazio — correr run-universe-scans',
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

  console.log(`${logPrefix} Scanner 1 top ${topN}: ${symbols.length} símbolos…`);

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

    let dailyCandles: Candle[];
    let candles15m: Candle[];
    try {
      dailyCandles = await fetchCandles(symbol, dailyTimeframe as '1d', 5);
      candles15m = await fetchCandles(symbol, chartTimeframe as '15m', 8);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }

    const levels = computePrevDayLevels(dailyCandles);
    if (!levels) continue;

    const hit = detectRumersBox15m(candles15m, levels, params);
    if (!hit) continue;

    const recent = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        generatedAt: { gte: new Date(Date.now() - 36 * 3600000) },
      },
      select: { id: true, direction: true, extraInfo: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (recent?.extraInfo) {
      try {
        const ex = JSON.parse(recent.extraInfo) as { barCloseTs?: number; dayKey?: string };
        if (ex.barCloseTs === hit.barCloseTs) continue;
        if (ex.dayKey === hit.levels.dayKey && recent.direction === hit.direction) continue;
      } catch {
        /* ignore */
      }
    }

    const arrow = hit.direction === 'BUY' ? '🟢' : '🔴';
    console.log(
      `${logPrefix} ${arrow} ${hit.direction} ${symbol} @ ${hit.entryPrice} (PDH ${hit.levels.prevHigh} / PDL ${hit.levels.prevLow})`
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
    `${logPrefix} Concluído: ${signalsCreated} sinais, ${executed} exec, ${timedClosed} fechos timed`
  );

  return {
    status: 'done',
    timedClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
  };
}
