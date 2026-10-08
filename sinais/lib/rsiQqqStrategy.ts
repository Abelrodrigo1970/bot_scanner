/**
 * rsi_qqq — top 30 Bybit stocks + QQQUSDT (1h)
 * LONG: RSI azul (SMA18 do RSI14) estava < 34 e sobe para ≥ 34 (ex. 33→35).
 *   Saída: SL −4% | TP1 +2% (50%) | TP2 +5% (resto 50%).
 * SHORT: EMA20 cruza para baixo EMA70.
 *   Saída: SL +6% | TP +5% | ou fecha quando entra LONG.
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import {
  calculateEMA,
  calculateRSISeries,
  calculateSMASeries,
  getCloses,
} from './indicators';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';
import { resolveRsiQqqSymbols, RSI_QQQ_SYMBOLS_DEFAULT } from './rsiQqqSymbols';

export const RSI_QQQ_STRATEGY_NAME = 'RSI_QQQ' as const;
export const RSI_QQQ_SYMBOL_DEFAULT = 'QQQUSDT';
export { RSI_QQQ_SYMBOLS_DEFAULT, resolveRsiQqqSymbols } from './rsiQqqSymbols';

export const RSI_QQQ_RSI_PERIOD_DEFAULT = 14;
export const RSI_QQQ_RSI_MA_PERIOD_DEFAULT = 18;
export const RSI_QQQ_RSI_MA_CROSS_LEVEL_DEFAULT = 34;
export const RSI_QQQ_STOP_LOSS_PCT_DEFAULT = 0.04;
export const RSI_QQQ_TP1_PCT_DEFAULT = 0.02;
export const RSI_QQQ_TP1_POSITION_DEFAULT = 50;
export const RSI_QQQ_TP2_PCT_DEFAULT = 0.05;
export const RSI_QQQ_TP2_POSITION_DEFAULT = 50;

export const RSI_QQQ_SHORT_EMA_FAST_DEFAULT = 20;
export const RSI_QQQ_SHORT_EMA_SLOW_DEFAULT = 70;
export const RSI_QQQ_SHORT_STOP_LOSS_PCT_DEFAULT = 0.06;
export const RSI_QQQ_SHORT_TP_PCT_DEFAULT = 0.05;

export type RsiQqqParams = {
  /** Lista operacional (top 30 stocks + QQQ). Tem prioridade sobre `symbol`. */
  symbols?: string[];
  /** @deprecated Preferir `symbols`. Fallback single-symbol. */
  symbol?: string;
  chartTimeframe?: string;
  rsiPeriod?: number;
  /** Período da média (SMA) do RSI — “RSI azul”. */
  rsiMaPeriod?: number;
  /** Compra quando a SMA do RSI cruza este nível de baixo para cima. */
  rsiMaCrossLevel?: number;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  tp2Pct?: number;
  tp2Position?: number;
  /** EMA rápida para SHORT (cruzamento ↓). */
  shortEmaFast?: number;
  /** EMA lenta para SHORT. */
  shortEmaSlow?: number;
  /** SL SHORT (% acima da entrada). */
  shortStopLossPct?: number;
  /** TP SHORT (% abaixo da entrada, 100% posição). */
  shortTpPct?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  buyEnabled?: boolean;
  allowSell?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type RsiQqqResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      signalsCreated: number;
      executed: number;
      symbols: string[];
      flippedClosed?: number;
    };

function parseParams(raw: string | null): RsiQqqParams {
  try {
    return raw ? (JSON.parse(raw) as RsiQqqParams) : {};
  } catch {
    return {};
  }
}

/** Corre no 1.º slot de 15m de cada hora (Lisboa) — vela 1h acabou de fechar. */
export function shouldRunRsiQqqSchedule(now: Date = new Date()): { ok: boolean; reason?: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { ok: true };
  if (minute >= 15) {
    return {
      ok: false,
      reason: `rsi_qqq só no 1.º quarto de hora (Lisboa ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`,
    };
  }
  return { ok: true };
}

async function expireOppositeAndClose(
  strategyId: string,
  symbol: string,
  oppositeDirection: 'BUY' | 'SELL',
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<boolean> {
  const openOpp = await prisma.signal.findFirst({
    where: {
      strategyId,
      symbol,
      direction: oppositeDirection,
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { id: true, status: true },
  });
  if (!openOpp) return false;

  let closed = false;
  if (openOpp.status === 'IN_PROGRESS') {
    const pos = await inspectActivePositionForSymbol(symbol, exchange);
    if (pos.inspectable && pos.hasPosition) {
      const result = await closeActivePositionForSymbol(symbol, exchange, { rotationClose: true });
      closed = !!result.closed;
      if (result.closed) {
        console.log(`${logPrefix} 🔄 Fechado ${oppositeDirection} ${symbol}: ${result.message}`);
      } else {
        console.warn(`${logPrefix} ⚠️ Falha ao fechar ${oppositeDirection} ${symbol}: ${result.message}`);
      }
    }
  }

  await prisma.signal.updateMany({
    where: {
      strategyId,
      symbol,
      direction: oppositeDirection,
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    data: { status: 'EXPIRED' },
  });
  console.log(`${logPrefix} ↩️ Expirado ${oppositeDirection} ${symbol} (flip)`);
  return closed;
}

/**
 * Detecta LONG: RSI SMA (azul) estava < nível e sobe para ≥ nível.
 * Ex.: 33 → 35 com nível 34.
 */
export function detectRsiQqqBuy(
  candles: Candle[],
  params: RsiQqqParams
): {
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  strength: number;
  barCloseTs: number;
  rsi: number;
  rsiMa: number;
  rsiMaPrev: number;
  extraInfoBase: Record<string, unknown>;
} | null {
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? RSI_QQQ_RSI_PERIOD_DEFAULT)));
  const rsiMaPeriod = Math.max(
    1,
    Math.floor(Number(params.rsiMaPeriod ?? RSI_QQQ_RSI_MA_PERIOD_DEFAULT))
  );
  const crossLevel = Number(params.rsiMaCrossLevel ?? RSI_QQQ_RSI_MA_CROSS_LEVEL_DEFAULT);
  const stopLossPct = Math.max(
    0.001,
    Number(params.stopLossPct ?? RSI_QQQ_STOP_LOSS_PCT_DEFAULT)
  );
  const tp1Pct = Math.max(0.001, Number(params.tp1Pct ?? RSI_QQQ_TP1_PCT_DEFAULT));
  const tp2Pct = Math.max(tp1Pct, Number(params.tp2Pct ?? RSI_QQQ_TP2_PCT_DEFAULT));
  const tp1Position = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.tp1Position ?? RSI_QQQ_TP1_POSITION_DEFAULT)))
  );
  const tp2Position = Math.min(
    100 - tp1Position,
    Math.max(1, Math.floor(Number(params.tp2Position ?? RSI_QQQ_TP2_POSITION_DEFAULT)))
  );

  const need = rsiPeriod + rsiMaPeriod + 5;
  if (candles.length < need + 1) return null;

  const closed = candles.slice(0, -1);
  if (closed.length < need) return null;

  const closes = getCloses(closed);
  const rsiArr = calculateRSISeries(closes, rsiPeriod);
  if (rsiArr.length < rsiMaPeriod + 1) return null;
  const rsiMaArr = calculateSMASeries(rsiArr, rsiMaPeriod);
  if (rsiMaArr.length < 2) return null;

  const close = closes[closes.length - 1]!;
  const rsi = rsiArr[rsiArr.length - 1]!;
  const rsiMa = rsiMaArr[rsiMaArr.length - 1]!;
  const rsiMaPrev = rsiMaArr[rsiMaArr.length - 2]!;
  const bar = closed[closed.length - 1]!;

  if (!Number.isFinite(rsiMa) || !Number.isFinite(rsiMaPrev)) return null;

  // Abaixo de 34 e começa a subir → cruza/alcança o nível (ex. 33→35)
  const risingFromBelow = rsiMaPrev < crossLevel && rsiMa > rsiMaPrev && rsiMa >= crossLevel;
  if (!risingFromBelow) return null;

  const entryPrice = close;
  const stopLoss = entryPrice * (1 - stopLossPct);
  const target1 = entryPrice * (1 + tp1Pct);
  const target2 = entryPrice * (1 + tp2Pct);
  if (!(stopLoss < entryPrice) || !(target1 > entryPrice) || !(target2 > target1)) return null;

  const strength = Math.min(
    92,
    Math.max(72, Math.round(78 + Math.min(10, (rsiMa - crossLevel) * 2 + (rsiMa - rsiMaPrev) * 3)))
  );

  return {
    entryPrice,
    stopLoss,
    target1,
    target2,
    strength,
    barCloseTs: bar.timestamp,
    rsi,
    rsiMa,
    rsiMaPrev,
    extraInfoBase: {
      setup: 'rsi_qqq',
      side: 'long',
      rsiPeriod,
      rsiMaPeriod,
      rsiMaCrossLevel: crossLevel,
      rsi: +rsi.toFixed(2),
      rsiMa: +rsiMa.toFixed(2),
      rsiMaPrev: +rsiMaPrev.toFixed(2),
      stopLossPct,
      tp1Pct,
      tp1Position,
      tp2Pct,
      tp2Position,
      barCloseTs: bar.timestamp,
    },
  };
}

/**
 * Detecta SHORT: EMA rápida cruza para baixo da EMA lenta (ex. EMA20 ↓ EMA70).
 */
export function detectRsiQqqSell(
  candles: Candle[],
  params: RsiQqqParams
): {
  entryPrice: number;
  stopLoss: number;
  target1: number;
  strength: number;
  barCloseTs: number;
  emaFast: number;
  emaFastPrev: number;
  emaSlow: number;
  emaSlowPrev: number;
  extraInfoBase: Record<string, unknown>;
} | null {
  const emaFastPeriod = Math.max(
    2,
    Math.floor(Number(params.shortEmaFast ?? RSI_QQQ_SHORT_EMA_FAST_DEFAULT))
  );
  const emaSlowPeriod = Math.max(
    emaFastPeriod + 1,
    Math.floor(Number(params.shortEmaSlow ?? RSI_QQQ_SHORT_EMA_SLOW_DEFAULT))
  );
  const stopLossPct = Math.max(
    0.001,
    Number(params.shortStopLossPct ?? RSI_QQQ_SHORT_STOP_LOSS_PCT_DEFAULT)
  );
  const tpPct = Math.max(0.001, Number(params.shortTpPct ?? RSI_QQQ_SHORT_TP_PCT_DEFAULT));

  const need = emaSlowPeriod + 5;
  if (candles.length < need + 1) return null;

  const closed = candles.slice(0, -1);
  if (closed.length < need) return null;

  const closes = getCloses(closed);
  const emaFastArr = calculateEMA(closes, emaFastPeriod);
  const emaSlowArr = calculateEMA(closes, emaSlowPeriod);
  if (!emaFastArr || emaFastArr.length < 2 || !emaSlowArr || emaSlowArr.length < 2) return null;

  const emaFast = emaFastArr[emaFastArr.length - 1]!;
  const emaFastPrev = emaFastArr[emaFastArr.length - 2]!;
  const emaSlow = emaSlowArr[emaSlowArr.length - 1]!;
  const emaSlowPrev = emaSlowArr[emaSlowArr.length - 2]!;
  if (
    ![emaFast, emaFastPrev, emaSlow, emaSlowPrev].every((v) => Number.isFinite(v) && v > 0)
  ) {
    return null;
  }

  // Cruzamento: EMA rápida estava ≥ lenta e agora está < lenta
  const crossDown = emaFastPrev >= emaSlowPrev && emaFast < emaSlow;
  if (!crossDown) return null;

  const bar = closed[closed.length - 1]!;
  const entryPrice = closes[closes.length - 1]!;
  const stopLoss = entryPrice * (1 + stopLossPct);
  const target1 = entryPrice * (1 - tpPct);
  if (!(stopLoss > entryPrice) || !(target1 < entryPrice)) return null;

  const spreadPct = ((emaSlow - emaFast) / emaSlow) * 100;
  const strength = Math.min(92, Math.max(72, Math.round(78 + Math.min(10, spreadPct * 2))));

  return {
    entryPrice,
    stopLoss,
    target1,
    strength,
    barCloseTs: bar.timestamp,
    emaFast,
    emaFastPrev,
    emaSlow,
    emaSlowPrev,
    extraInfoBase: {
      setup: 'rsi_qqq_short',
      side: 'short',
      shortEmaFast: emaFastPeriod,
      shortEmaSlow: emaSlowPeriod,
      emaFast: +emaFast.toFixed(4),
      emaFastPrev: +emaFastPrev.toFixed(4),
      emaSlow: +emaSlow.toFixed(4),
      emaSlowPrev: +emaSlowPrev.toFixed(4),
      shortStopLossPct: stopLossPct,
      shortTpPct: tpPct,
      /** 100% da posição no único TP (lido por tradingRules). */
      tp1Position: 100,
      tp1Pct: tpPct,
      stopLossPct,
      barCloseTs: bar.timestamp,
    },
  };
}

export async function runRsiQqqPipeline(options?: {
  logPrefix?: string;
  force?: boolean;
}): Promise<RsiQqqResult> {
  const logPrefix = options?.logPrefix ?? '[rsi_qqq]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: RSI_QQQ_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia RSI_QQQ não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  if (!options?.force) {
    const slot = shouldRunRsiQqqSchedule(new Date());
    if (!slot.ok) return { status: 'skipped', reason: slot.reason ?? 'fora do horário' };
  }

  const params = parseParams(strategy.params);
  const allowBuy = !(params.allowBuy === false || params.buyEnabled === false);
  const allowSell = !(params.allowSell === false || params.sellEnabled === false);
  if (!allowBuy && !allowSell) {
    return { status: 'skipped', reason: 'BUY e SELL desactivados nos params' };
  }

  const symbols = resolveRsiQqqSymbols(params);
  const chartTimeframe = String(params.chartTimeframe ?? '1h');
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? RSI_QQQ_RSI_PERIOD_DEFAULT)));
  const rsiMaPeriod = Math.max(
    1,
    Math.floor(Number(params.rsiMaPeriod ?? RSI_QQQ_RSI_MA_PERIOD_DEFAULT))
  );
  const crossLevel = Number(params.rsiMaCrossLevel ?? RSI_QQQ_RSI_MA_CROSS_LEVEL_DEFAULT);
  const stopLossPct = Number(params.stopLossPct ?? RSI_QQQ_STOP_LOSS_PCT_DEFAULT);
  const tp1Pct = Number(params.tp1Pct ?? RSI_QQQ_TP1_PCT_DEFAULT);
  const tp1Position = Number(params.tp1Position ?? RSI_QQQ_TP1_POSITION_DEFAULT);
  const tp2Pct = Number(params.tp2Pct ?? RSI_QQQ_TP2_PCT_DEFAULT);
  const tp2Position = Number(params.tp2Position ?? RSI_QQQ_TP2_POSITION_DEFAULT);
  const shortEmaFast = Number(params.shortEmaFast ?? RSI_QQQ_SHORT_EMA_FAST_DEFAULT);
  const shortEmaSlow = Number(params.shortEmaSlow ?? RSI_QQQ_SHORT_EMA_SLOW_DEFAULT);
  const shortStopLossPct = Number(
    params.shortStopLossPct ?? RSI_QQQ_SHORT_STOP_LOSS_PCT_DEFAULT
  );
  const shortTpPct = Number(params.shortTpPct ?? RSI_QQQ_SHORT_TP_PCT_DEFAULT);
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Number(params.autoExecuteMinStrength ?? 70);

  console.log(
    `${logPrefix} ${symbols.length} símbolos | TF ${chartTimeframe} | LONG RSI${rsiPeriod} SMA${rsiMaPeriod} ↑${crossLevel} TP +${(tp1Pct * 100).toFixed(0)}%@${tp1Position}% +${(tp2Pct * 100).toFixed(0)}%@${tp2Position}% SL −${(stopLossPct * 100).toFixed(0)}% | SHORT EMA${shortEmaFast}↓EMA${shortEmaSlow} TP −${(shortTpPct * 100).toFixed(0)}% SL +${(shortStopLossPct * 100).toFixed(0)}%`
  );

  const startedAt = new Date();
  const warm = Math.max(120, rsiPeriod + rsiMaPeriod + 20, shortEmaSlow + 20);
  let signalsCreated = 0;
  let flippedClosed = 0;
  const hitSymbols: string[] = [];

  for (const symbol of symbols) {
    let candles: Candle[];
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '1h', warm);
    } catch (err) {
      console.warn(`${logPrefix} Falha klines ${symbol}:`, err);
      continue;
    }

    const buyHit = allowBuy ? detectRsiQqqBuy(candles, params) : null;
    const sellHit = allowSell ? detectRsiQqqSell(candles, params) : null;
    const direction: 'BUY' | 'SELL' | null = buyHit ? 'BUY' : sellHit ? 'SELL' : null;
    if (!direction) continue;

    const hit = direction === 'BUY' ? buyHit! : sellHit!;

    const openSame = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        direction,
        status: { in: ['NEW', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (openSame) continue;

    const recent = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        generatedAt: { gte: new Date(Date.now() - 48 * 3600000) },
      },
      select: { extraInfo: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (recent?.extraInfo) {
      try {
        const ex = JSON.parse(recent.extraInfo) as { barCloseTs?: number };
        if (ex.barCloseTs === hit.barCloseTs) continue;
      } catch {
        /* ignore */
      }
    }

    const opposite: 'BUY' | 'SELL' = direction === 'BUY' ? 'SELL' : 'BUY';
    if (
      await expireOppositeAndClose(strategy.id, symbol, opposite, exchange, logPrefix)
    ) {
      flippedClosed++;
    }

    if (direction === 'BUY' && buyHit) {
      const extraInfo = JSON.stringify({
        ...buyHit.extraInfoBase,
        symbol,
        executionProfile: `BUY | ${symbol} | ${chartTimeframe} RSI${rsiPeriod} SMA${rsiMaPeriod} cruza ↑${crossLevel} (ex. ${buyHit.rsiMaPrev.toFixed(1)}→${buyHit.rsiMa.toFixed(1)}) | TP1 +${(tp1Pct * 100).toFixed(0)}% (${tp1Position}%) | TP2 +${(tp2Pct * 100).toFixed(0)}% (${tp2Position}%) | SL −${(stopLossPct * 100).toFixed(0)}%`,
      });
      console.log(
        `${logPrefix} 🟢 LONG ${symbol} @ ${buyHit.entryPrice} (RSI SMA ${buyHit.rsiMaPrev.toFixed(1)}→${buyHit.rsiMa.toFixed(1)} | TP +${(tp1Pct * 100).toFixed(0)}%/${(tp2Pct * 100).toFixed(0)}% | SL −${(stopLossPct * 100).toFixed(0)}%)`
      );
      await prisma.signal.create({
        data: {
          symbol,
          direction: 'BUY',
          timeframe: chartTimeframe,
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: buyHit.entryPrice,
          stopLoss: buyHit.stopLoss,
          target1: buyHit.target1,
          target2: buyHit.target2,
          target3: null,
          strength: buyHit.strength,
          status: 'NEW',
          extraInfo,
        },
      });
    } else if (sellHit) {
      const extraInfo = JSON.stringify({
        ...sellHit.extraInfoBase,
        symbol,
        executionProfile: `SELL | ${symbol} | ${chartTimeframe} EMA${shortEmaFast}↓EMA${shortEmaSlow} (${sellHit.emaFastPrev.toFixed(2)}/${sellHit.emaSlowPrev.toFixed(2)} → ${sellHit.emaFast.toFixed(2)}/${sellHit.emaSlow.toFixed(2)}) | TP −${(shortTpPct * 100).toFixed(0)}% | SL +${(shortStopLossPct * 100).toFixed(0)}% | fecha no LONG`,
      });
      console.log(
        `${logPrefix} 🔴 SHORT ${symbol} @ ${sellHit.entryPrice} (EMA${shortEmaFast}↓EMA${shortEmaSlow} | TP −${(shortTpPct * 100).toFixed(0)}% | SL +${(shortStopLossPct * 100).toFixed(0)}%)`
      );
      await prisma.signal.create({
        data: {
          symbol,
          direction: 'SELL',
          timeframe: chartTimeframe,
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: sellHit.entryPrice,
          stopLoss: sellHit.stopLoss,
          target1: sellHit.target1,
          target2: null,
          target3: null,
          strength: sellHit.strength,
          status: 'NEW',
          extraInfo,
        },
      });
    }

    signalsCreated++;
    hitSymbols.push(symbol);
  }

  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${signalsCreated} sinal(is) | flips ${flippedClosed} | exec ${executed}`
  );

  return {
    status: 'done',
    signalsCreated,
    executed,
    symbols: hitSymbols,
    flippedClosed,
  };
}
