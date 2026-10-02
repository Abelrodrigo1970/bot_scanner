/**
 * Rumer's Box (15m) — PDH breakout no Scanner 1 (EMA70 1d).
 *
 * Entrada: só BUY — fecho 15m cruza acima do high do dia anterior
 *   (vela anterior dentro da caixa 0,8–12%).
 * Saída (estudo SL12%):
 *   SL −12% na exchange
 *   Scale-out temporal: 30% @ 48h · 40% @ 72h · restante 30% @ 7d
 *   (sem TP de preço)
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RUMERS_BOX_15M_STRATEGY_NAME = 'RUMERS_BOX_15M' as const;

/** % da posição *actual* a fechar em cada stage (após 48h rem=70%; 40/70≈57.14%). */
const SCALE_PCT_OF_REMAINING_48H = 30;
const SCALE_PCT_OF_REMAINING_72H = (40 / 70) * 100; // ≈57.142857 → deixa 30% da original

export type RumersBox15mParams = {
  universeTopN?: number;
  chartTimeframe?: string;
  dailyTimeframe?: string;
  requireInsideBeforeBreak?: boolean;
  minBoxRangePct?: number;
  maxBoxRangePct?: number;
  stopLossPct?: number;
  /** Horas até fechar 30% da posição original. */
  scaleHours1?: number;
  /** Horas até fechar +40% da original (sobre o remanescente). */
  scaleHours2?: number;
  /** Horas até fechar o restante (7d = 168). */
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
  strength: number;
  barCloseTs: number;
  levels: RumersBoxLevels;
  extraInfo: string;
};

type ScaleStage = '48h' | '72h' | '7d';

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

/**
 * Scale-out: 30% @ scaleHours1 · 40% @ scaleHours2 · resto @ closeAfterHours.
 * Marca stages em extraInfo.scaleStagesDone.
 */
async function processScaleOutExits(
  strategyId: string,
  params: RumersBox15mParams,
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<number> {
  const h1 = Math.max(1, Math.floor(Number(params.scaleHours1 ?? 48)));
  const h2 = Math.max(h1 + 1, Math.floor(Number(params.scaleHours2 ?? 72)));
  const hFinal = Math.max(h2 + 1, Math.floor(Number(params.closeAfterHours ?? 168)));

  const openSignals = await prisma.signal.findMany({
    where: { strategyId, status: 'IN_PROGRESS' },
    select: { id: true, symbol: true, generatedAt: true, extraInfo: true },
    orderBy: { generatedAt: 'asc' },
  });

  const now = Date.now();
  let actions = 0;

  for (const sig of openSignals) {
    let extra: Record<string, unknown> = {};
    try {
      extra = sig.extraInfo ? (JSON.parse(sig.extraInfo) as Record<string, unknown>) : {};
    } catch {
      extra = {};
    }

    const stagesDone = Array.isArray(extra.scaleStagesDone)
      ? (extra.scaleStagesDone as string[])
      : [];
    const ageH = (now - sig.generatedAt.getTime()) / 3600000;

    const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);

    // Sem posição (SL na exchange) → expirar sinal
    if (pos.inspectable && !pos.hasPosition) {
      await prisma.signal.update({ where: { id: sig.id }, data: { status: 'EXPIRED' } });
      continue;
    }

    let nextStage: ScaleStage | null = null;
    let pctOfCurrent = 0;

    if (ageH >= hFinal) {
      nextStage = '7d';
      pctOfCurrent = 100;
    } else if (ageH >= h2 && !stagesDone.includes('72h')) {
      nextStage = '72h';
      // Se 48h falhou/atrasou, fechar o equivalente a 70% da original de uma vez
      pctOfCurrent = stagesDone.includes('48h')
        ? SCALE_PCT_OF_REMAINING_72H
        : 70;
    } else if (ageH >= h1 && !stagesDone.includes('48h')) {
      nextStage = '48h';
      pctOfCurrent = SCALE_PCT_OF_REMAINING_48H;
    }

    if (!nextStage || !(pctOfCurrent > 0)) continue;

    if (!(pos.inspectable && pos.hasPosition)) {
      console.warn(`${logPrefix} ⚠️ Scale ${nextStage} ${sig.symbol}: posição não inspectável`);
      continue;
    }

    const result = await closeActivePositionForSymbol(sig.symbol, exchange, {
      timedClose: true,
      percentOfPosition: pctOfCurrent,
    });

    if (!result.closed) {
      console.warn(`${logPrefix} ⚠️ Scale ${nextStage} falhou ${sig.symbol}: ${result.message}`);
      continue;
    }

    actions++;
    const updatedStages = [...stagesDone];
    if (nextStage === '48h') {
      updatedStages.push('48h');
    } else if (nextStage === '72h') {
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
      console.log(`${logPrefix} ⏱️ ${sig.symbol} scale ${nextStage} (fecho final): ${result.message}`);
    } else {
      await prisma.signal.update({
        where: { id: sig.id },
        data: { extraInfo: JSON.stringify(nextExtra) },
      });
      console.log(
        `${logPrefix} ⏱️ ${sig.symbol} scale ${nextStage} (−${pctOfCurrent.toFixed(1)}% remanescente): ${result.message}`
      );
    }
  }

  return actions;
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
  const scaleHours1 = Math.max(1, Math.floor(Number(params.scaleHours1 ?? 48)));
  const scaleHours2 = Math.max(scaleHours1 + 1, Math.floor(Number(params.scaleHours2 ?? 72)));
  const closeAfterHours = Math.max(scaleHours2 + 1, Math.floor(Number(params.closeAfterHours ?? 168)));
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
  if (!(stopLoss < entryPrice)) return null;

  const breakPct = ((curr.close - prevHigh) / prevHigh) * 100;
  const strength = Math.min(95, Math.max(70, Math.round(72 + Math.min(18, breakPct * 10))));
  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;

  return {
    direction: 'BUY',
    entryPrice,
    stopLoss,
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
      scaleHours1,
      scaleHours2,
      closeAfterHours,
      scaleStagesDone: [],
      barCloseTs: curr.timestamp,
      executionProfile: `BUY | Rumer's Box PDH ${levels.dayKey} | SL −${slLabel} | scale 30%@${scaleHours1}h · 40%@${scaleHours2}h · resto @${closeAfterHours}h`,
    }),
  };
}

/**
 * Cron 15m: Scanner 1 → Rumer's Box LONG + scale-out timed.
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

  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 20)));
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const dailyTimeframe = String(params.dailyTimeframe ?? '1d');
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Math.max(60, Math.floor(Number(params.autoExecuteMinStrength ?? 70)));

  const symbols = await resolveUniverseScanSymbolsTopN(UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D, topN);
  if (symbols.length === 0) {
    return {
      status: 'skipped',
      reason: 'Scanner 1 vazio — correr run-universe-scans',
    };
  }

  const timedClosed = await processScaleOutExits(strategy.id, params, exchange, logPrefix);

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
      `${logPrefix} 🟢 BUY ${symbol} @ ${hit.entryPrice} (PDH ${hit.levels.prevHigh} | SL −12% | scale 48/72/7d)`
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
        target1: null,
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
    `${logPrefix} Concluído: ${signalsCreated} sinais, ${executed} exec, ${timedClosed} scale-outs`
  );

  return {
    status: 'done',
    timedClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
  };
}
