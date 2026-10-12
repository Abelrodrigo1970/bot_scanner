/**
 * EMA70 1h S1 — LONG 1h no Scanner 1 top 50 (EMA70 1d).
 * Entrada: fecho 1h cruza EMA70 1h para cima, corpo da vela < 4% e BTC 4h < +1%.
 * Saída: TP1 +25% (50%) | resto quando fecho 1h < EMA70 × (1 − 3%) | SL −5%.
 */

import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import { calculateEMA, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const EMA70_1H_S1_LONG_STRATEGY_NAME = 'EMA70_1H_S1_LONG' as const;

export const EMA70_1H_S1_LONG_TOP_N_DEFAULT = 50;
export const EMA70_1H_S1_LONG_EMA_PERIOD_DEFAULT = 70;
export const EMA70_1H_S1_LONG_EXIT_BELOW_EMA_PCT_DEFAULT = 0.03;
export const EMA70_1H_S1_LONG_STOP_LOSS_PCT_DEFAULT = 0.05;
export const EMA70_1H_S1_LONG_TP1_PCT_DEFAULT = 0.25;
export const EMA70_1H_S1_LONG_TP1_POSITION_DEFAULT = 50;
export const EMA70_1H_S1_LONG_MAX_ENTRY_BODY_PCT_DEFAULT = 0.04;
export const EMA70_1H_S1_LONG_BTC_MAX_4H_CHANGE_PCT_DEFAULT = 0.01;
const BTC_SYMBOL = 'BTCUSDT';

export type Ema70_1hS1LongParams = {
  universeTopN?: number;
  chartTimeframe?: string;
  emaPeriod?: number;
  /** Sai quando fecho < EMA × (1 − este valor). */
  exitBelowEmaPct?: number;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  /** Só entra se (fecho − abertura) / abertura da vela de entrada < este valor. */
  maxEntryBodyPct?: number;
  btcFilter?: boolean;
  /** Só entra se a variação do BTC nas últimas 4 velas 1h fechadas < este valor. */
  btcMax4hChangePct?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  buyEnabled?: boolean;
  allowSell?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Ema70_1hS1LongResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      emaClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Ema70_1hS1LongParams {
  try {
    return raw ? (JSON.parse(raw) as Ema70_1hS1LongParams) : {};
  } catch {
    return {};
  }
}

/** Corre no 1.º slot de 15m de cada hora (Lisboa) — vela 1h acabou de fechar. */
export function shouldRunEma70_1hS1LongSchedule(now: Date = new Date()): { ok: boolean; reason?: string } {
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
      reason: `EMA70 1h S1 só no 1.º quarto de hora (Lisboa ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`,
    };
  }
  return { ok: true };
}

type ClosedBarEma = {
  open: number;
  close: number;
  prevClose: number;
  ema: number;
  emaPrev: number;
  barCloseTs: number;
};

/** Última vela 1h fechada (exclui a vela em formação) + EMA nessa vela e na anterior. */
export function lastClosedBarWithEma(candles: Candle[], emaPeriod: number): ClosedBarEma | null {
  const closed = candles.slice(0, -1);
  if (closed.length < emaPeriod + 2) return null;
  const closes = getCloses(closed);
  const emaArr = calculateEMA(closes, emaPeriod);
  if (!emaArr || emaArr.length < 2) return null;
  const ema = emaArr[emaArr.length - 1]!;
  const emaPrev = emaArr[emaArr.length - 2]!;
  if (!(ema > 0) || !(emaPrev > 0)) return null;
  return {
    open: closed[closed.length - 1]!.open,
    close: closes[closes.length - 1]!,
    prevClose: closes[closes.length - 2]!,
    ema,
    emaPrev,
    barCloseTs: closed[closed.length - 1]!.timestamp,
  };
}

/** Variação (fração) do fecho da última vela 1h fechada vs 4 velas antes. */
export function btcChange4hFromCandles(candles: Candle[]): { change: number; barCloseTs: number } | null {
  const closed = candles.slice(0, -1);
  if (closed.length < 5) return null;
  const last = closed[closed.length - 1]!;
  const ref = closed[closed.length - 5]!;
  if (!(ref.close > 0)) return null;
  return { change: last.close / ref.close - 1, barCloseTs: last.timestamp };
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

/**
 * Cron 15m (1.º quarto de hora Lisboa): Scanner 1 top N → LONG no cruzamento EMA70 1h.
 */
export async function runEma70_1hS1LongPipeline(options?: {
  logPrefix?: string;
  force?: boolean;
}): Promise<Ema70_1hS1LongResult> {
  const logPrefix = options?.logPrefix ?? '[ema70_1h_s1]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: EMA70_1H_S1_LONG_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia EMA70_1H_S1_LONG não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  if (!options?.force) {
    const slot = shouldRunEma70_1hS1LongSchedule(new Date());
    if (!slot.ok) return { status: 'skipped', reason: slot.reason ?? 'fora do horário' };
  }

  const params = parseParams(strategy.params);
  const allowBuy = params.allowBuy !== false && params.buyEnabled !== false;

  const chartTimeframe = String(params.chartTimeframe ?? '1h');
  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? EMA70_1H_S1_LONG_TOP_N_DEFAULT)));
  const emaPeriod = Math.max(
    2,
    Math.floor(Number(params.emaPeriod ?? EMA70_1H_S1_LONG_EMA_PERIOD_DEFAULT))
  );
  const exitBelowEmaPct = Math.max(
    0,
    Number(params.exitBelowEmaPct ?? EMA70_1H_S1_LONG_EXIT_BELOW_EMA_PCT_DEFAULT)
  );
  const stopLossPct = Math.max(
    0.005,
    Number(params.stopLossPct ?? EMA70_1H_S1_LONG_STOP_LOSS_PCT_DEFAULT)
  );
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? EMA70_1H_S1_LONG_TP1_PCT_DEFAULT));
  const tp1Position = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.tp1Position ?? EMA70_1H_S1_LONG_TP1_POSITION_DEFAULT)))
  );
  const maxEntryBodyPct = Math.max(
    0,
    Number(params.maxEntryBodyPct ?? EMA70_1H_S1_LONG_MAX_ENTRY_BODY_PCT_DEFAULT)
  );
  const btcFilter = params.btcFilter !== false;
  const btcMax4hChangePct = Number(
    params.btcMax4hChangePct ?? EMA70_1H_S1_LONG_BTC_MAX_4H_CHANGE_PCT_DEFAULT
  );
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Number(params.autoExecuteMinStrength ?? 70);
  // EMA precisa de ~3× o período para convergir.
  const warm = emaPeriod * 3 + 10;

  const symbols = await resolveUniverseScanSymbolsTopN(UNIVERSE_CODE_SCANNER_1_ABOVE_EMA70_1D, topN);

  console.log(
    `${logPrefix} Scanner 1 top ${topN}: ${symbols.length} | TF ${chartTimeframe} | fecho cruza EMA${emaPeriod}↑ | corpo < ${(maxEntryBodyPct * 100).toFixed(1)}% | BTC 4h < +${(btcMax4hChangePct * 100).toFixed(1)}%${btcFilter ? '' : ' (off)'} | sai fecho < EMA${emaPeriod} −${(exitBelowEmaPct * 100).toFixed(1)}% | TP1 +${(tp1Pct * 100).toFixed(0)}%@${tp1Position}% | SL −${(stopLossPct * 100).toFixed(0)}%`
  );

  const startedAt = new Date();

  const openLongs = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { id: true, symbol: true },
  });
  const openSet = new Set(openLongs.map((s) => s.symbol));

  // 1) Saída: posições abertas (mesmo fora do top N) com fecho < EMA − buffer
  let emaClosed = 0;
  for (const symbol of [...openSet]) {
    let candles: Candle[];
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '1h', warm);
    } catch {
      continue;
    }
    const bar = lastClosedBarWithEma(candles, emaPeriod);
    if (!bar) continue;
    const exitLevel = bar.ema * (1 - exitBelowEmaPct);
    if (bar.close < exitLevel) {
      await closeOpenLong(
        strategy.id,
        symbol,
        exchange,
        logPrefix,
        `fecho 1h ${bar.close.toFixed(6)} < EMA${emaPeriod} −${(exitBelowEmaPct * 100).toFixed(1)}% (${exitLevel.toFixed(6)})`
      );
      emaClosed++;
      openSet.delete(symbol);
    }
  }

  if (!allowBuy) {
    return { status: 'done', emaClosed, signalsCreated: 0, executed: 0, symbols: [] };
  }
  if (!symbols.length) {
    console.log(`${logPrefix} Scanner 1 vazio — correr run-universe-scans`);
    return { status: 'done', emaClosed, signalsCreated: 0, executed: 0, symbols: [] };
  }

  // 2) Filtro BTC: sem entradas se o BTC subiu ≥ limite nas últimas 4h
  let btcChange4h: number | null = null;
  if (btcFilter) {
    try {
      const btc = btcChange4hFromCandles(await fetchCandles(BTC_SYMBOL, chartTimeframe as '1h', 10));
      btcChange4h = btc?.change ?? null;
    } catch {
      btcChange4h = null;
    }
    if (btcChange4h == null) {
      console.warn(`${logPrefix} ⚠️ BTC 4h indisponível — entradas bloqueadas neste ciclo`);
      return { status: 'done', emaClosed, signalsCreated: 0, executed: 0, symbols: [] };
    }
    if (!(btcChange4h < btcMax4hChangePct)) {
      console.log(
        `${logPrefix} ⏭ BTC 4h +${(btcChange4h * 100).toFixed(2)}% ≥ +${(btcMax4hChangePct * 100).toFixed(1)}% — sem entradas neste ciclo`
      );
      return { status: 'done', emaClosed, signalsCreated: 0, executed: 0, symbols: [] };
    }
  }

  // 3) Entrada: cruzamento EMA70 1h para cima
  let signalsCreated = 0;
  const hitSymbols: string[] = [];

  for (const symbol of symbols) {
    if (openSet.has(symbol)) continue;

    let candles: Candle[];
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '1h', warm);
    } catch {
      continue;
    }
    const bar = lastClosedBarWithEma(candles, emaPeriod);
    if (!bar) continue;

    const crossUp = bar.prevClose <= bar.emaPrev && bar.close > bar.ema;
    if (!crossUp) continue;

    const bodyPct = bar.open > 0 ? bar.close / bar.open - 1 : Infinity;
    if (!(bodyPct < maxEntryBodyPct)) {
      console.log(
        `${logPrefix} ⏭ ${symbol} cruzou EMA${emaPeriod} mas corpo +${(bodyPct * 100).toFixed(2)}% ≥ ${(maxEntryBodyPct * 100).toFixed(1)}%`
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
        if (ex.barCloseTs === bar.barCloseTs) continue;
      } catch {
        /* ignore */
      }
    }

    const entryPrice = bar.close;
    const stopLoss = entryPrice * (1 - stopLossPct);
    const target1 = entryPrice * (1 + tp1Pct);
    const distEmaPct = (bar.close / bar.ema - 1) * 100;
    const strength = Math.min(92, Math.max(70, Math.round(78 + Math.min(12, distEmaPct * 3))));

    const extraInfo = JSON.stringify({
      setup: 'ema70_1h_s1_long',
      universeTopN: topN,
      emaPeriod,
      ema: Number(bar.ema.toFixed(8)),
      emaPrev: Number(bar.emaPrev.toFixed(8)),
      distEmaPct: +distEmaPct.toFixed(2),
      bodyPct: +(bodyPct * 100).toFixed(2),
      maxEntryBodyPct,
      btcChange4hPct: btcChange4h != null ? +(btcChange4h * 100).toFixed(2) : null,
      btcMax4hChangePct: btcFilter ? btcMax4hChangePct : null,
      exitBelowEmaPct,
      stopLossPct,
      tp1Pct,
      tp1Position,
      barCloseTs: bar.barCloseTs,
      executionProfile: `BUY | Scanner 1 top ${topN} | 1h fecho cruza EMA${emaPeriod}↑ | corpo < ${(maxEntryBodyPct * 100).toFixed(1)}%${btcFilter ? ` | BTC 4h < +${(btcMax4hChangePct * 100).toFixed(1)}%` : ''} | TP1 +${(tp1Pct * 100).toFixed(0)}% (${tp1Position}%) | resto fecho < EMA${emaPeriod} −${(exitBelowEmaPct * 100).toFixed(1)}% | SL −${(stopLossPct * 100).toFixed(0)}%`,
    });

    console.log(
      `${logPrefix} 🟢 LONG ${symbol} @ ${entryPrice} (EMA${emaPeriod} cross↑ ${bar.ema.toFixed(6)} | +${distEmaPct.toFixed(2)}%)`
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
        target1,
        target2: null,
        target3: null,
        strength,
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
    `${logPrefix} Concluído: ${signalsCreated} LONG | ${emaClosed} saídas EMA | exec ${executed}`
  );

  return {
    status: 'done',
    emaClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
  };
}
