/**
 * rsi_vendido — LONG bounce no universo RSI(14) 4h < 32.
 * Estudo 30 Jul–13 Ago 2026: RSI cruza abaixo de 25 → LONG;
 * sai quando cruza acima de 32 (ou SL −5% / 24h). 47 trades, +3,47%, WR 68%.
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateRSISeries, getCloses } from './indicators';
import { UNIVERSE_CODE_RSI_VENDIDO } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RSI_VENDIDO_STRATEGY_NAME = 'RSI_VENDIDO_4H' as const;

export type RsiVendidoParams = {
  topN?: number;
  chartTimeframe?: string;
  rsiPeriod?: number;
  /** RSI 4h: entra LONG no cruzamento abaixo deste nível. */
  rsiEntryLevel?: number;
  /** RSI 4h: fecha LONG no cruzamento acima deste nível. */
  rsiExitLevel?: number;
  /** @deprecated Use rsiEntryLevel */
  rsiLevel?: number;
  stopLossPct?: number;
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
      rsiClosed: number;
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
  if (rsi < 20) return 94;
  if (rsi < 25) return 90;
  if (rsi < 28) return 86;
  return 82;
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

    await closeOpenLong(strategyId, sig.symbol, exchange, logPrefix, `${closeHours}h`, true);
    closed++;
  }

  return closed;
}

export async function runRsiVendidoPipeline(options?: {
  logPrefix?: string;
}): Promise<RsiVendidoResult> {
  const logPrefix = options?.logPrefix ?? '[rsi_vendido]';

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
  const topN = Math.max(1, Math.min(80, Math.floor(Number(params.topN ?? 80))));
  const chartTimeframe = String(params.chartTimeframe ?? '4h');
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? 14)));
  const rsiEntryLevel = Number(params.rsiEntryLevel ?? params.rsiLevel ?? 25);
  const rsiExitLevel = Number(params.rsiExitLevel ?? 32);
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.05));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;

  const scan = await getTopRankedUniverseScanRows(UNIVERSE_CODE_RSI_VENDIDO, topN);
  if (!scan.ok) {
    return { status: 'skipped', reason: scan.reason };
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
  const rankBySymbol = new Map(scan.rows.map((r) => [r.symbol, r.rank]));
  const universeSymbols = new Set(scan.rows.map((r) => r.symbol));

  const startedAt = new Date();
  let rsiClosed = 0;
  let signalsCreated = 0;
  const symbols: string[] = [];
  const closedSymbols: string[] = [];
  const candleLimit = Math.min(500, Math.max(rsiPeriod + 20, 80));

  const toCheck = new Set<string>([...universeSymbols, ...openLongSet]);

  for (const symbol of toCheck) {
    let candles;
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '4h', candleLimit);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }
    if (candles.length < rsiPeriod + 5) continue;

    const closed = candles.slice(0, -1);
    const closes = getCloses(closed);
    const rsi = calculateRSISeries(closes, rsiPeriod);
    if (rsi.length < 2) continue;

    const curr = rsi[rsi.length - 1];
    const prev = rsi[rsi.length - 2];
    const signalBar = closed[closed.length - 1];
    const entryPrice = signalBar.close;
    if (!(entryPrice > 0)) continue;

    const crossUp = prev <= rsiExitLevel && curr > rsiExitLevel;
    const crossDown = prev >= rsiEntryLevel && curr < rsiEntryLevel;
    const hasOpenLong = openLongSet.has(symbol);

    if (crossUp && hasOpenLong) {
      await closeOpenLong(
        strategy.id,
        symbol,
        exchange,
        logPrefix,
        `RSI cruza > ${rsiExitLevel}`
      );
      rsiClosed++;
      closedSymbols.push(symbol);
      openLongSet.delete(symbol);
      console.log(
        `${logPrefix} ⏹️ EXIT LONG ${symbol} RSI ${prev.toFixed(1)}→${curr.toFixed(1)} > ${rsiExitLevel}`
      );
      continue;
    }

    if (!allowBuy || !crossDown || !universeSymbols.has(symbol) || hasOpenLong) continue;

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
    const rank = rankBySymbol.get(symbol);
    const strength = strengthForRsi(curr);

    console.log(
      `${logPrefix} 🟢 LONG #${rank ?? '?'} ${symbol} @ ${entryPrice} (RSI ${prev.toFixed(1)}→${curr.toFixed(1)} < ${rsiEntryLevel}, SL -${(stopLossPct * 100).toFixed(0)}%)`
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
        target1: null,
        target2: null,
        target3: null,
        strength,
        status: 'NEW',
        extraInfo: JSON.stringify({
          setup: 'rsi_vendido_4h',
          scannerRank: rank ?? null,
          scanRunId: scan.runId,
          scannedAt: scan.scannedAt.toISOString(),
          barCloseTs,
          rsiPrev: Number(prev.toFixed(2)),
          rsi: Number(curr.toFixed(2)),
          rsiEntryLevel,
          rsiExitLevel,
          rsiPeriod,
          stopLossPct,
          closeAfterHours,
          topN,
          crossover: `RSI(${rsiPeriod}) ${chartTimeframe} cruza abaixo de ${rsiEntryLevel}`,
          executionProfile: `LONG rsi_vendido Top ${topN} | RSI(${rsiPeriod}) ${chartTimeframe} cruza < ${rsiEntryLevel} | SL -${(stopLossPct * 100).toFixed(0)}% | sai se RSI > ${rsiExitLevel} ou ${closeAfterHours}h | sem SHORT`,
        }),
      },
    });

    signalsCreated++;
    symbols.push(symbol);
    openLongSet.add(symbol);
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 80);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${timedClosed} por tempo, ${rsiClosed} RSI>32, ${signalsCreated} LONG, ${executed} executados`
  );

  return {
    status: 'done',
    timedClosed,
    rsiClosed,
    signalsCreated,
    executed,
    symbols,
    closedSymbols,
  };
}
