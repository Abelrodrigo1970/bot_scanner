/**
 * Scanner 2 Top 3 — LONG quando RSI(14) em 4h cruza acima de 80.
 * Estudo: ranks 1–3 (evitar #4); SL −10%; fecho 24h; sem TP.
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateRSISeries, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const SCANNER2_RSI80_TOP3_LONG_STRATEGY_NAME = 'SCANNER2_RSI80_TOP3_LONG_4H' as const;

export type Scanner2Rsi80Top3LongParams = {
  topN?: number;
  chartTimeframe?: string;
  rsiPeriod?: number;
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

export type Scanner2Rsi80Top3LongResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Scanner2Rsi80Top3LongParams {
  try {
    return raw ? (JSON.parse(raw) as Scanner2Rsi80Top3LongParams) : {};
  } catch {
    return {};
  }
}

function strengthForRank(rank: number): number {
  if (rank === 1) return 92;
  if (rank === 2) return 90;
  return 88;
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
 * Após scan Scanner 2 (ou cron backup): fecha LONGs ≥ 24h;
 * abre LONG nos ranks 1–3 se RSI(14) 4h acabou de cruzar acima de 80.
 */
export async function runScanner2Rsi80Top3LongPipeline(options?: {
  logPrefix?: string;
}): Promise<Scanner2Rsi80Top3LongResult> {
  const logPrefix = options?.logPrefix ?? '[Scanner2 RSI80 Top3 LONG]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER2_RSI80_TOP3_LONG_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia SCANNER2_RSI80_TOP3_LONG_4H não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const topN = Math.max(1, Math.min(3, Math.floor(Number(params.topN ?? 3))));
  const chartTimeframe = String(params.chartTimeframe ?? '4h');
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? 14)));
  const rsiLevel = Number(params.rsiLevel ?? 80);
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.1));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);

  const scan = await getTopRankedUniverseScanRows(UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H, topN);
  if (!scan.ok) {
    return { status: 'skipped', reason: scan.reason };
  }

  const timedClosed = await closeTimedOutPositions(
    strategy.id,
    closeAfterHours,
    exchange,
    logPrefix
  );

  const candidates = scan.rows.filter((r) => r.rank >= 1 && r.rank <= topN);
  if (candidates.length === 0) {
    return {
      status: 'done',
      timedClosed,
      signalsCreated: 0,
      executed: 0,
      symbols: [],
    };
  }

  const startedAt = new Date();
  let signalsCreated = 0;
  const symbols: string[] = [];
  const candleLimit = Math.min(500, Math.max(rsiPeriod + 20, 80));

  for (const row of candidates) {
    const existingOpen = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol: row.symbol,
        status: { in: ['NEW', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (existingOpen) {
      console.log(`${logPrefix} ⏭️ Já aberto/NEW em ${row.symbol} — ignorado`);
      continue;
    }

    let candles;
    try {
      candles = await fetchCandles(row.symbol, chartTimeframe as '4h', candleLimit);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${row.symbol}:`, err);
      continue;
    }
    if (candles.length < rsiPeriod + 5) continue;

    // Remove vela em formação
    const closed = candles.slice(0, -1);
    const closes = getCloses(closed);
    const rsi = calculateRSISeries(closes, rsiPeriod);
    if (rsi.length < 2) continue;

    const curr = rsi[rsi.length - 1];
    const prev = rsi[rsi.length - 2];
    if (!(prev <= rsiLevel && curr > rsiLevel)) {
      continue;
    }

    const signalBar = closed[closed.length - 1];
    const entryPrice = signalBar.close;
    if (!(entryPrice > 0)) continue;

    const barCloseTs = signalBar.timestamp;
    const recentSameBar = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol: row.symbol,
        generatedAt: { gte: new Date(Date.now() - 48 * 3600000) },
      },
      select: { id: true, extraInfo: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (recentSameBar?.extraInfo) {
      try {
        const ex = JSON.parse(recentSameBar.extraInfo) as { barCloseTs?: number };
        if (ex.barCloseTs === barCloseTs) {
          console.log(`${logPrefix} ⏭️ Cruzamento já sinalizado ${row.symbol} bar ${barCloseTs}`);
          continue;
        }
      } catch {
        /* ignore */
      }
    }

    const stopLoss = entryPrice * (1 - stopLossPct);
    const strength = strengthForRank(row.rank);

    console.log(
      `${logPrefix} 🟢 LONG #${row.rank} ${row.symbol} @ ${entryPrice} (RSI ${prev.toFixed(1)}→${curr.toFixed(1)} > ${rsiLevel}, SL -${(stopLossPct * 100).toFixed(0)}%, hold ${closeAfterHours}h)`
    );

    await prisma.signal.create({
      data: {
        symbol: row.symbol,
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
          setup: 'scanner2_rsi80_top3_long_4h',
          rank: row.rank,
          pumpPct24h: row.pctFromMa,
          scanRunId: scan.runId,
          scannedAt: scan.scannedAt.toISOString(),
          barCloseTs,
          rsiPrev: Number(prev.toFixed(2)),
          rsi: Number(curr.toFixed(2)),
          rsiLevel,
          rsiPeriod,
          stopLossPct,
          closeAfterHours,
          topN,
          executionProfile: `LONG Top ${topN} Scanner 2 | RSI(${rsiPeriod}) ${chartTimeframe} cruza > ${rsiLevel} | SL -${(stopLossPct * 100).toFixed(0)}% | fecho ${closeAfterHours}h | sem TP`,
        }),
      },
    });

    signalsCreated++;
    symbols.push(row.symbol);
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 80);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${timedClosed} fechados por tempo, ${signalsCreated} LONG, ${executed} executados`
  );

  return {
    status: 'done',
    timedClosed,
    signalsCreated,
    executed,
    symbols,
  };
}
