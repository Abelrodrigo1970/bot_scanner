/**
 * rsi_vendido LONG (15m) — Scanner 6 (acima SMA80 4h).
 * Entrada: RSI(14) 15m fecha abaixo de 28 (cruzamento).
 * SL −5% | TP1 +10% (30% pos.) | TP2 +48% (30% pos.).
 * Restante: RSI cruza para baixo da SMA(RSI) com RSI > 65.
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateRSISeries, calculateSMASeries, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H } from './symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RSI_VENDIDO_STRATEGY_NAME = 'RSI_VENDIDO_4H' as const;

export type RsiVendidoParams = {
  universeTopN?: number;
  /** @deprecated Prefer universeTopN */
  topN?: number;
  chartTimeframe?: string;
  rsiPeriod?: number;
  /** Compra quando RSI fecha abaixo deste nível (cruzamento). */
  rsiEntryLevel?: number;
  /** SMA sobre o RSI (linha base). */
  rsiMaPeriod?: number;
  /** Saída do resto: cruzamento RSI×MA só conta se RSI > este nível. */
  rsiTrailMinLevel?: number;
  /** @deprecated Use rsiEntryLevel */
  rsiLevel?: number;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  tp2Pct?: number;
  tp2Position?: number;
  /** 0 = sem fecho por tempo. */
  closeAfterHours?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type RsiVendidoResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      rsiMaClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
      closedSymbols: string[];
    };

function parseParams(raw: string | null): RsiVendidoParams {
  try {
    return raw ? (JSON.parse(raw) as RsiVendidoParams) : {};
  } catch {
    return {};
  }
}

function strengthForRsi(rsi: number): number {
  if (rsi < 18) return 94;
  if (rsi < 22) return 90;
  if (rsi < 26) return 86;
  if (rsi < 28) return 82;
  return 78;
}

async function closeOpenLong(
  strategyId: string,
  symbol: string,
  exchange: 'binance' | 'bybit',
  logPrefix: string,
  reason: string,
  timedClose = false
): Promise<boolean> {
  const pos = await inspectActivePositionForSymbol(symbol, exchange);
  let closed = false;
  if (pos.inspectable && pos.hasPosition) {
    const result = await closeActivePositionForSymbol(symbol, exchange, {
      rotationClose: !timedClose,
      timedClose,
    });
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

async function closeTimedOutPositions(
  strategyId: string,
  defaultCloseHours: number,
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<number> {
  if (defaultCloseHours <= 0) return 0;

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
    if (!(closeHours > 0)) continue;

    const ageMs = now - sig.generatedAt.getTime();
    if (ageMs < closeHours * 3600000) continue;

    await closeOpenLong(strategyId, sig.symbol, exchange, logPrefix, `${closeHours}h`, true);
    closed++;
  }

  return closed;
}

export async function runRsiVendidoPipeline(options?: {
  logPrefix?: string;
}): Promise<RsiVendidoResult> {
  const logPrefix = options?.logPrefix ?? '[rsi_vendido 15m]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: RSI_VENDIDO_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia RSI_VENDIDO_4H não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const topN = Math.max(
    1,
    Math.min(80, Math.floor(Number(params.universeTopN ?? params.topN ?? 40)))
  );
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? 14)));
  const rsiEntryLevel = Number(params.rsiEntryLevel ?? params.rsiLevel ?? 28);
  const rsiMaPeriod = Math.max(2, Math.floor(Number(params.rsiMaPeriod ?? 14)));
  const rsiTrailMinLevel = Number(params.rsiTrailMinLevel ?? 65);
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.05));
  const tp1Pct = Math.max(0.1, Number(params.tp1Pct ?? 10));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 30))));
  const tp2Pct = Math.max(0.1, Number(params.tp2Pct ?? 48));
  const tp2Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp2Position ?? 30))));
  const closeAfterHours = Math.max(0, Math.floor(Number(params.closeAfterHours ?? 0)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;

  const symbols = await resolveUniverseScanSymbolsTopN(
    UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H,
    topN
  );
  if (symbols.length === 0) {
    return {
      status: 'skipped',
      reason: 'Scanner 6 vazio — correr run-universe-scans',
    };
  }

  const timedClosed = await closeTimedOutPositions(
    strategy.id,
    closeAfterHours,
    exchange,
    logPrefix
  );

  const openLongs = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { symbol: true },
  });
  const openLongSet = new Set(openLongs.map((s) => s.symbol));
  const universeSymbols = new Set(symbols);

  const startedAt = new Date();
  let rsiMaClosed = 0;
  let signalsCreated = 0;
  const hitSymbols: string[] = [];
  const closedSymbols: string[] = [];
  const candleLimit = Math.min(500, Math.max(rsiPeriod + rsiMaPeriod + 40, 120));

  const toCheck = new Set<string>([...universeSymbols, ...openLongSet]);
  console.log(
    `${logPrefix} Scanner 6 top ${topN}: ${symbols.length} símbolos | abertos ${openLongSet.size}`
  );

  for (const symbol of toCheck) {
    let candles;
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '15m', candleLimit);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }
    if (candles.length < rsiPeriod + rsiMaPeriod + 5) continue;

    const closed = candles.slice(0, -1);
    const closes = getCloses(closed);
    const rsi = calculateRSISeries(closes, rsiPeriod);
    const rsiMa = calculateSMASeries(rsi, rsiMaPeriod);
    if (rsi.length < 2 || rsiMa.length < 2) continue;

    const curr = rsi[rsi.length - 1]!;
    const prev = rsi[rsi.length - 2]!;
    const currMa = rsiMa[rsiMa.length - 1];
    const prevMa = rsiMa[rsiMa.length - 2];
    const signalBar = closed[closed.length - 1]!;
    const entryPrice = signalBar.close;
    if (!(entryPrice > 0) || !Number.isFinite(curr) || !Number.isFinite(prev)) continue;

    const hasOpenLong = openLongSet.has(symbol);

    // Saída resto: RSI cruza para baixo da SMA(RSI) com RSI > 65
    if (
      hasOpenLong &&
      currMa != null &&
      prevMa != null &&
      Number.isFinite(currMa) &&
      Number.isFinite(prevMa) &&
      curr > rsiTrailMinLevel &&
      prev >= prevMa &&
      curr < currMa
    ) {
      await closeOpenLong(
        strategy.id,
        symbol,
        exchange,
        logPrefix,
        `RSI×MA down RSI ${curr.toFixed(1)} > ${rsiTrailMinLevel}`
      );
      rsiMaClosed++;
      closedSymbols.push(symbol);
      openLongSet.delete(symbol);
      console.log(
        `${logPrefix} ⏹️ EXIT resto ${symbol} RSI ${prev.toFixed(1)}→${curr.toFixed(1)} cruza MA ${prevMa.toFixed(1)}→${currMa.toFixed(1)}`
      );
      continue;
    }

    // Entrada: RSI fecha abaixo de 28 (cruzamento)
    const crossBelow =
      Number.isFinite(prev) && Number.isFinite(curr) && prev >= rsiEntryLevel && curr < rsiEntryLevel;

    if (!allowBuy || !crossBelow || !universeSymbols.has(symbol) || hasOpenLong) continue;

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
    const target1 = entryPrice * (1 + tp1Pct / 100);
    const target2 = entryPrice * (1 + tp2Pct / 100);
    const strength = strengthForRsi(curr);

    console.log(
      `${logPrefix} 🟢 LONG ${symbol} @ ${entryPrice} (RSI ${prev.toFixed(1)}→${curr.toFixed(1)} < ${rsiEntryLevel} | SL −${(stopLossPct * 100).toFixed(0)}% | TP1 +${tp1Pct}% ${tp1Position}% | TP2 +${tp2Pct}% ${tp2Position}%)`
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
        target2,
        target3: null,
        strength,
        status: 'NEW',
        extraInfo: JSON.stringify({
          setup: 'rsi_vendido_15m',
          universe: UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H,
          universeTopN: topN,
          barCloseTs,
          rsiPrev: Number(prev.toFixed(2)),
          rsi: Number(curr.toFixed(2)),
          rsiEntryLevel,
          rsiMaPeriod,
          rsiTrailMinLevel,
          rsiPeriod,
          stopLossPct,
          tp1Pct,
          tp1Position,
          tp2Pct,
          tp2Position,
          closeAfterHours,
          crossover: `RSI(${rsiPeriod}) ${chartTimeframe} fecha/cruza abaixo de ${rsiEntryLevel}`,
          executionProfile: `LONG Scanner 6 top ${topN} | RSI(${rsiPeriod}) 15m < ${rsiEntryLevel} | SL −${(stopLossPct * 100).toFixed(0)}% | TP1 +${tp1Pct}% (${tp1Position}%) | TP2 +${tp2Pct}% (${tp2Position}%) | resto: RSI×SMA${rsiMaPeriod} down com RSI > ${rsiTrailMinLevel}`,
        }),
      },
    });

    signalsCreated++;
    hitSymbols.push(symbol);
    openLongSet.add(symbol);
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 70);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${timedClosed} por tempo, ${rsiMaClosed} RSI×MA, ${signalsCreated} LONG, ${executed} executados`
  );

  return {
    status: 'done',
    timedClosed,
    rsiMaClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
    closedSymbols,
  };
}
