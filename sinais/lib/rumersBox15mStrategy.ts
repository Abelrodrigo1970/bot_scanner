/**
 * Rumer's Box (15m) — PDH breakout no Scanner 1 (EMA70 1d).
 *
 * Entrada: só BUY — fecho 15m cruza acima do high do dia anterior
 *   (vela anterior dentro da caixa 0,8–12%).
 * Saída (estudo TP65 @50%):
 *   SL −12% na exchange
 *   TP1 +65% (50% da posição)
 *   Restante às 72h
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
  requireInsideBeforeBreak?: boolean;
  minBoxRangePct?: number;
  maxBoxRangePct?: number;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  /** Horas até fechar o restante (após TP parcial). */
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
  direction: 'BUY';
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

  return {
    prevHigh,
    prevLow,
    prevMid,
    boxHeight,
    boxRangePct: (boxHeight / prevMid) * 100,
    dayKey: utcDayKey(prev.timestamp),
    dailyBarTs: prev.timestamp,
  };
}

/** % da posição *actual* a fechar em cada stage legacy (após 48h rem=70%; 40/70≈57.14%). */
const LEGACY_SCALE_PCT_48H = 30;
const LEGACY_SCALE_PCT_72H = (40 / 70) * 100;

/**
 * Legacy scale-out para sinais abertos antes do TP65 (extra.scaleHours1 presente).
 */
async function processLegacyScaleOut(
  sig: { id: string; symbol: string; generatedAt: Date; extraInfo: string | null },
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<boolean> {
  let extra: Record<string, unknown> = {};
  try {
    extra = sig.extraInfo ? (JSON.parse(sig.extraInfo) as Record<string, unknown>) : {};
  } catch {
    extra = {};
  }

  const h1 = Math.max(1, Math.floor(Number(extra.scaleHours1 ?? 48)));
  const h2 = Math.max(h1 + 1, Math.floor(Number(extra.scaleHours2 ?? 72)));
  const hFinal = Math.max(h2 + 1, Math.floor(Number(extra.closeAfterHours ?? 168)));
  const stagesDone = Array.isArray(extra.scaleStagesDone)
    ? (extra.scaleStagesDone as string[])
    : [];
  const ageH = (Date.now() - sig.generatedAt.getTime()) / 3600000;

  const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);
  if (pos.inspectable && !pos.hasPosition) {
    await prisma.signal.update({ where: { id: sig.id }, data: { status: 'EXPIRED' } });
    return false;
  }

  let nextStage: '48h' | '72h' | '7d' | null = null;
  let pctOfCurrent = 0;
  if (ageH >= hFinal) {
    nextStage = '7d';
    pctOfCurrent = 100;
  } else if (ageH >= h2 && !stagesDone.includes('72h')) {
    nextStage = '72h';
    pctOfCurrent = stagesDone.includes('48h') ? LEGACY_SCALE_PCT_72H : 70;
  } else if (ageH >= h1 && !stagesDone.includes('48h')) {
    nextStage = '48h';
    pctOfCurrent = LEGACY_SCALE_PCT_48H;
  }
  if (!nextStage || !(pctOfCurrent > 0)) return false;
  if (!(pos.inspectable && pos.hasPosition)) return false;

  const result = await closeActivePositionForSymbol(sig.symbol, exchange, {
    timedClose: true,
    percentOfPosition: pctOfCurrent,
  });
  if (!result.closed) {
    console.warn(`${logPrefix} ⚠️ Legacy scale ${nextStage} falhou ${sig.symbol}: ${result.message}`);
    return false;
  }

  const updatedStages = [...stagesDone];
  if (nextStage === '48h') updatedStages.push('48h');
  else if (nextStage === '72h') {
    if (!updatedStages.includes('48h')) updatedStages.push('48h');
    updatedStages.push('72h');
  } else {
    if (!updatedStages.includes('48h')) updatedStages.push('48h');
    if (!updatedStages.includes('72h')) updatedStages.push('72h');
    updatedStages.push('7d');
  }
  const nextExtra = {
    ...extra,
    scaleStagesDone: updatedStages,
    lastScaleAt: new Date().toISOString(),
    lastScaleStage: nextStage,
  };
  if (nextStage === '7d' || pctOfCurrent >= 100) {
    await prisma.signal.update({
      where: { id: sig.id },
      data: { status: 'EXPIRED', extraInfo: JSON.stringify(nextExtra) },
    });
  } else {
    await prisma.signal.update({
      where: { id: sig.id },
      data: { extraInfo: JSON.stringify(nextExtra) },
    });
  }
  console.log(`${logPrefix} ⏱️ ${sig.symbol} legacy scale ${nextStage}: ${result.message}`);
  return true;
}

/**
 * Fecha posições abertas após closeAfterHours (resto pós-TP).
 * Sinais antigos com scaleHours1 mantêm o scale-out 48/72/7d.
 */
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
    let extra: Record<string, unknown> = {};
    try {
      extra = sig.extraInfo ? (JSON.parse(sig.extraInfo) as Record<string, unknown>) : {};
    } catch {
      extra = {};
    }

    // Posições abertas sob a regra antiga (scale temporal)
    if (extra.scaleHours1 != null || (Array.isArray(extra.scaleStagesDone) && extra.scaleStagesDone.length > 0)) {
      if (await processLegacyScaleOut(sig, exchange, logPrefix)) closed++;
      continue;
    }

    let closeHours = defaultCloseHours;
    if (extra.closeAfterHours != null) closeHours = Number(extra.closeAfterHours);

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
 * Detecta LONG: cruzamento do PDH na última vela 15m fechada.
 */
export function detectRumersBox15m(
  candles15m: Candle[],
  levels: RumersBoxLevels,
  params: RumersBox15mParams
): RumersBoxHit | null {
  const requireInsideBeforeBreak = params.requireInsideBeforeBreak !== false;
  const minBoxRangePct = Math.max(0, Number(params.minBoxRangePct ?? 0.8));
  const maxBoxRangePct = Math.max(minBoxRangePct, Number(params.maxBoxRangePct ?? 12));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.12));
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? 0.65));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 72)));
  const allowBuy = !(params.allowBuy === false || params.buyEnabled === false);

  if (!allowBuy) return null;
  if (levels.boxRangePct < minBoxRangePct || levels.boxRangePct > maxBoxRangePct) return null;

  const closed = candles15m.slice(0, -1);
  if (closed.length < 2) return null;

  const curr = closed[closed.length - 1]!;
  const prevBar = closed[closed.length - 2]!;
  if (!(curr.close > 0) || !(prevBar.close > 0)) return null;

  const { prevHigh, prevLow, prevMid, boxHeight } = levels;

  const crossedPdh = curr.close > prevHigh && prevBar.close <= prevHigh;
  if (!crossedPdh) return null;
  if (requireInsideBeforeBreak && !(prevBar.close >= prevLow && prevBar.close <= prevHigh)) {
    return null;
  }

  const entryPrice = curr.close;
  const stopLoss = entryPrice * (1 - stopLossPct);
  const target1 = entryPrice * (1 + tp1Pct);
  if (!(stopLoss < entryPrice) || !(target1 > entryPrice)) return null;

  const breakPct = ((curr.close - prevHigh) / prevHigh) * 100;
  const strength = Math.min(95, Math.max(70, Math.round(72 + Math.min(18, breakPct * 10))));
  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
  const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;

  return {
    direction: 'BUY',
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
      executionProfile: `BUY | Rumer's Box PDH ${levels.dayKey} | SL −${slLabel} | TP1 +${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
    }),
  };
}

/**
 * Cron 15m: Scanner 1 → Rumer's Box LONG + TP parcial + fecho timed.
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
  if (params.allowBuy === false || params.buyEnabled === false) {
    return { status: 'skipped', reason: 'BUY desactivado nos params' };
  }

  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 50)));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const dailyTimeframe = String(params.dailyTimeframe ?? '1d');
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 72)));
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
        if (ex.dayKey === hit.levels.dayKey) continue;
      } catch {
        /* ignore */
      }
    }

    console.log(
      `${logPrefix} 🟢 BUY ${symbol} @ ${hit.entryPrice} (PDH ${hit.levels.prevHigh} | SL −12% | TP1 +65% 50% | resto 72h)`
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
