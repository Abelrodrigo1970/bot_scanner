/**
 * rsi_1h_long — LONG 1h
 * Entrada: fecho cruza EMA12↑ + RSI azul (SMA do RSI14) < 40
 *          + distância ao EMA70 diário < 40% (Scanner 1 completo).
 * Saída: TP1 +19% (30%) | TP2 +39% (50%) | resto às 72h | SL −7%.
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import {
  calculateEMA,
  calculateLastEMA,
  calculateRSISeries,
  calculateSMASeries,
  getCloses,
} from './indicators';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbols } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RSI_1H_LONG_STRATEGY_NAME = 'RSI_1H_LONG' as const;

export const RSI_1H_LONG_RSI_PERIOD_DEFAULT = 14;
export const RSI_1H_LONG_RSI_MA_PERIOD_DEFAULT = 14;
export const RSI_1H_LONG_RSI_MA_MAX_DEFAULT = 40;
export const RSI_1H_LONG_EMA_PERIOD_DEFAULT = 12;
export const RSI_1H_LONG_EMA_DAILY_PERIOD_DEFAULT = 70;
export const RSI_1H_LONG_EMA_DAILY_MAX_PCT_ABOVE_DEFAULT = 0.4;
export const RSI_1H_LONG_TP1_PCT_DEFAULT = 0.19;
export const RSI_1H_LONG_TP1_POSITION_DEFAULT = 30;
export const RSI_1H_LONG_TP2_PCT_DEFAULT = 0.39;
export const RSI_1H_LONG_TP2_POSITION_DEFAULT = 50;
export const RSI_1H_LONG_CLOSE_AFTER_HOURS_DEFAULT = 72;
export const RSI_1H_LONG_STOP_LOSS_PCT_DEFAULT = 0.07;

export type Rsi1hLongParams = {
  chartTimeframe?: string;
  emaPeriod?: number;
  rsiPeriod?: number;
  /** Período da média azul do RSI (SMA sobre o RSI). */
  rsiMaPeriod?: number;
  /** Só entra se RSI azul < este nível. */
  rsiMaMax?: number;
  /** EMA diária para filtro de stretch. */
  emaDailyPeriod?: number;
  /** Só entra se (preço/EMA diária − 1) < este valor (ex.: 0.4 = 40%). */
  emaDailyMaxPctAbove?: number;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  tp2Pct?: number;
  tp2Position?: number;
  /** Fechar restante após N horas. */
  closeAfterHours?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  buyEnabled?: boolean;
  allowSell?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Rsi1hLongResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Rsi1hLongParams {
  try {
    return raw ? (JSON.parse(raw) as Rsi1hLongParams) : {};
  } catch {
    return {};
  }
}

/** Corre no 1.º slot de 15m de cada hora (Lisboa) — vela 1h acabou de fechar. */
export function shouldRunRsi1hLongSchedule(now: Date = new Date()): { ok: boolean; reason?: string } {
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
      reason: `rsi_1h_long só no 1.º quarto de hora (Lisboa ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`,
    };
  }
  return { ok: true };
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

/** Última EMA diária fechada (exclui vela 1d em formação). */
export function lastClosedDailyEma(dailyCandles: Candle[], period: number): number | null {
  if (dailyCandles.length < period + 1) return null;
  const closed = dailyCandles.slice(0, -1);
  if (closed.length < period) return null;
  return calculateLastEMA(
    closed.map((c) => c.close),
    period
  );
}

/**
 * Detecta LONG: cruzamento do fecho acima da EMA + RSI azul < máx.
 * O filtro EMA70 diário é aplicado no pipeline (precisa de velas 1d).
 */
export function detectRsi1hLongBuy(
  candles: Candle[],
  params: Rsi1hLongParams
): {
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  strength: number;
  barCloseTs: number;
  ema: number;
  emaPrev: number;
  rsi: number;
  rsiMa: number;
  extraInfoBase: Record<string, unknown>;
} | null {
  const emaPeriod = Math.max(2, Math.floor(Number(params.emaPeriod ?? RSI_1H_LONG_EMA_PERIOD_DEFAULT)));
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? RSI_1H_LONG_RSI_PERIOD_DEFAULT)));
  const rsiMaPeriod = Math.max(
    1,
    Math.floor(Number(params.rsiMaPeriod ?? RSI_1H_LONG_RSI_MA_PERIOD_DEFAULT))
  );
  const rsiMaMax = Number(params.rsiMaMax ?? RSI_1H_LONG_RSI_MA_MAX_DEFAULT);
  const stopLossPct = Math.max(
    0.005,
    Number(params.stopLossPct ?? RSI_1H_LONG_STOP_LOSS_PCT_DEFAULT)
  );
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? RSI_1H_LONG_TP1_PCT_DEFAULT));
  const tp2Pct = Math.max(tp1Pct, Number(params.tp2Pct ?? RSI_1H_LONG_TP2_PCT_DEFAULT));
  const tp1Position = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.tp1Position ?? RSI_1H_LONG_TP1_POSITION_DEFAULT)))
  );
  const tp2Position = Math.min(
    100 - tp1Position,
    Math.max(1, Math.floor(Number(params.tp2Position ?? RSI_1H_LONG_TP2_POSITION_DEFAULT)))
  );
  const closeAfterHours = Math.max(
    1,
    Math.floor(Number(params.closeAfterHours ?? RSI_1H_LONG_CLOSE_AFTER_HOURS_DEFAULT))
  );

  const need = Math.max(emaPeriod, rsiPeriod + rsiMaPeriod) + 5;
  if (candles.length < need + 1) return null;

  const closed = candles.slice(0, -1);
  if (closed.length < need) return null;

  const closes = getCloses(closed);
  const emaArr = calculateEMA(closes, emaPeriod);
  if (!emaArr || emaArr.length < 2) return null;

  const rsiArr = calculateRSISeries(closes, rsiPeriod);
  if (rsiArr.length < rsiMaPeriod + 1) return null;
  const rsiMaArr = calculateSMASeries(rsiArr, rsiMaPeriod);
  if (rsiMaArr.length < 1) return null;

  const close = closes[closes.length - 1]!;
  const prevClose = closes[closes.length - 2]!;
  const ema = emaArr[emaArr.length - 1]!;
  const emaPrev = emaArr[emaArr.length - 2]!;
  const rsi = rsiArr[rsiArr.length - 1]!;
  const rsiMa = rsiMaArr[rsiMaArr.length - 1]!;
  const bar = closed[closed.length - 1]!;

  if (!(ema > 0) || !(emaPrev > 0)) return null;
  if (!(Number.isFinite(rsiMa) && rsiMa < rsiMaMax)) return null;

  const crossUp = prevClose <= emaPrev && close > ema;
  if (!crossUp) return null;

  const entryPrice = close;
  const stopLoss = entryPrice * (1 - stopLossPct);
  const target1 = entryPrice * (1 + tp1Pct);
  const target2 = entryPrice * (1 + tp2Pct);
  if (!(stopLoss < entryPrice) || !(target1 > entryPrice) || !(target2 > target1)) return null;

  const distEmaPct = (close / ema - 1) * 100;
  const strength = Math.min(
    92,
    Math.max(70, Math.round(78 + Math.min(12, (rsiMaMax - rsiMa) * 0.4 + Math.max(0, distEmaPct) * 2)))
  );

  return {
    entryPrice,
    stopLoss,
    target1,
    target2,
    strength,
    barCloseTs: bar.timestamp,
    ema,
    emaPrev,
    rsi,
    rsiMa,
    extraInfoBase: {
      setup: 'rsi_1h_long',
      emaPeriod,
      rsiPeriod,
      rsiMaPeriod,
      rsiMaMax,
      ema: Number(ema.toFixed(8)),
      emaPrev: Number(emaPrev.toFixed(8)),
      rsi: +rsi.toFixed(2),
      rsiMa: +rsiMa.toFixed(2),
      stopLossPct,
      tp1Pct,
      tp1Position,
      tp2Pct,
      tp2Position,
      closeAfterHours,
      barCloseTs: bar.timestamp,
    },
  };
}

/**
 * Cron 15m (1.º quarto de hora Lisboa): Scanner 1 completo → rsi_1h_long.
 */
export async function runRsi1hLongPipeline(options?: {
  logPrefix?: string;
  force?: boolean;
}): Promise<Rsi1hLongResult> {
  const logPrefix = options?.logPrefix ?? '[rsi_1h_long]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: RSI_1H_LONG_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia RSI_1H_LONG não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  if (!options?.force) {
    const slot = shouldRunRsi1hLongSchedule(new Date());
    if (!slot.ok) return { status: 'skipped', reason: slot.reason ?? 'fora do horário' };
  }

  const params = parseParams(strategy.params);
  if (params.allowBuy === false || params.buyEnabled === false) {
    return { status: 'skipped', reason: 'BUY desactivado nos params' };
  }

  const chartTimeframe = String(params.chartTimeframe ?? '1h');
  const emaPeriod = Math.max(2, Math.floor(Number(params.emaPeriod ?? RSI_1H_LONG_EMA_PERIOD_DEFAULT)));
  const emaDailyPeriod = Math.max(
    2,
    Math.floor(Number(params.emaDailyPeriod ?? RSI_1H_LONG_EMA_DAILY_PERIOD_DEFAULT))
  );
  const emaDailyMaxPctAbove = Math.max(
    0.01,
    Number(params.emaDailyMaxPctAbove ?? RSI_1H_LONG_EMA_DAILY_MAX_PCT_ABOVE_DEFAULT)
  );
  const closeAfterHours = Math.max(
    1,
    Math.floor(Number(params.closeAfterHours ?? RSI_1H_LONG_CLOSE_AFTER_HOURS_DEFAULT))
  );
  const tp1Pct = Number(params.tp1Pct ?? RSI_1H_LONG_TP1_PCT_DEFAULT);
  const tp1Position = Number(params.tp1Position ?? RSI_1H_LONG_TP1_POSITION_DEFAULT);
  const tp2Pct = Number(params.tp2Pct ?? RSI_1H_LONG_TP2_PCT_DEFAULT);
  const tp2Position = Number(params.tp2Position ?? RSI_1H_LONG_TP2_POSITION_DEFAULT);
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Number(params.autoExecuteMinStrength ?? 70);

  const symbols = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D);
  if (!symbols.length) {
    return { status: 'skipped', reason: 'Scanner 1 vazio — correr run-universe-scans' };
  }

  console.log(
    `${logPrefix} Scanner 1 completo: ${symbols.length} | TF ${chartTimeframe} | EMA${emaPeriod} cross↑ + RSI azul < ${params.rsiMaMax ?? RSI_1H_LONG_RSI_MA_MAX_DEFAULT} | dist EMA${emaDailyPeriod} 1d < ${(emaDailyMaxPctAbove * 100).toFixed(0)}% | TP +${(tp1Pct * 100).toFixed(0)}%@${tp1Position}% +${(tp2Pct * 100).toFixed(0)}%@${tp2Position}% | resto ${closeAfterHours}h`
  );

  const startedAt = new Date();
  const timedClosed = await closeTimedOutPositions(strategy.id, closeAfterHours, exchange, logPrefix);

  const openLongs = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { id: true, symbol: true },
  });
  const openSet = new Set(openLongs.map((s) => s.symbol));

  let signalsCreated = 0;
  const hitSymbols: string[] = [];
  const warm = Math.max(80, emaPeriod + (params.rsiPeriod ?? 14) + (params.rsiMaPeriod ?? 14) + 10);
  const warmDaily = emaDailyPeriod + 15;

  for (const symbol of symbols) {
    if (openSet.has(symbol)) continue;

    let candles: Candle[];
    let daily: Candle[];
    try {
      [candles, daily] = await Promise.all([
        fetchCandles(symbol, chartTimeframe as '1h', warm),
        fetchCandles(symbol, '1d', warmDaily),
      ]);
    } catch {
      continue;
    }

    const hit = detectRsi1hLongBuy(candles, params);
    if (!hit) continue;

    const emaDaily = lastClosedDailyEma(daily, emaDailyPeriod);
    if (emaDaily == null || !(emaDaily > 0)) continue;
    const distDailyPct = (hit.entryPrice / emaDaily - 1) * 100;
    if (!(distDailyPct < emaDailyMaxPctAbove * 100)) {
      console.log(
        `${logPrefix} ⏭ ${symbol} bloqueado: dist EMA${emaDailyPeriod} 1d ${distDailyPct.toFixed(1)}% ≥ ${(emaDailyMaxPctAbove * 100).toFixed(0)}%`
      );
      continue;
    }

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

    const stopLossPct = Number(params.stopLossPct ?? RSI_1H_LONG_STOP_LOSS_PCT_DEFAULT);
    const extraInfo = JSON.stringify({
      ...hit.extraInfoBase,
      emaDailyPeriod,
      emaDailyMaxPctAbove,
      emaDaily: Number(emaDaily.toFixed(8)),
      distEmaDailyPct: +distDailyPct.toFixed(2),
      executionProfile: `BUY | Scanner 1 completo | 1h fecho cruza EMA${emaPeriod}↑ + RSI azul < ${params.rsiMaMax ?? RSI_1H_LONG_RSI_MA_MAX_DEFAULT} | dist EMA${emaDailyPeriod} 1d < ${(emaDailyMaxPctAbove * 100).toFixed(0)}% | TP1 +${(tp1Pct * 100).toFixed(0)}% (${tp1Position}%) | TP2 +${(tp2Pct * 100).toFixed(0)}% (${tp2Position}%) | resto ${closeAfterHours}h | SL −${(stopLossPct * 100).toFixed(0)}%`,
    });

    console.log(
      `${logPrefix} 🟢 LONG ${symbol} @ ${hit.entryPrice} (EMA${emaPeriod} cross↑ | RSI azul ${hit.rsiMa.toFixed(1)} | dist EMA70d ${distDailyPct.toFixed(1)}% | TP +${(tp1Pct * 100).toFixed(0)}%/${(tp2Pct * 100).toFixed(0)}%)`
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
        target2: hit.target2,
        target3: null,
        strength: hit.strength,
        status: 'NEW',
        extraInfo,
      },
    });

    signalsCreated++;
    hitSymbols.push(symbol);
    openSet.add(symbol);
  }

  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${signalsCreated} LONG | timed ${timedClosed} | exec ${executed}`
  );

  return {
    status: 'done',
    timedClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
  };
}
