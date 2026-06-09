/**
 * Scanner 1 Top 8 — rotação total a cada scan (4 h).
 * Fecha todas as posições e recompra o top N ao preço do scan actual.
 */

import { prisma } from './db';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';
import { strategyAllowsAutoExecuteDirection } from './signalEngine';

export const SCANNER1_TOP8_STRATEGY_NAME = 'SCANNER1_TOP8' as const;
const LAST_RUN_SETTING_KEY = 'SCANNER1_TOP8_LAST_RUN_ID';

export type Scanner1Top8Params = {
  topN?: number;
  stopLossPct?: number;
  closeAfterHours?: number;
  exchange?: 'binance' | 'bybit';
  allowBuy?: boolean;
  autoExecuteMinStrength?: number;
  rotationMode?: 'full' | 'incremental';
};

export type Scanner1Top8Result =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      runId: string;
      closed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Scanner1Top8Params {
  try {
    return raw ? (JSON.parse(raw) as Scanner1Top8Params) : {};
  } catch {
    return {};
  }
}

async function getLastProcessedRunId(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: LAST_RUN_SETTING_KEY } });
  return row?.value ?? null;
}

async function setLastProcessedRunId(runId: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: LAST_RUN_SETTING_KEY },
    create: { key: LAST_RUN_SETTING_KEY, value: runId },
    update: { value: runId },
  });
}

/** Fecha todas as posições abertas desta estratégia (rotação total). */
async function closeAllStrategyPositions(
  strategyId: string,
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<number> {
  const openSignals = await prisma.signal.findMany({
    where: {
      strategyId,
      status: { in: ['IN_PROGRESS', 'NEW'] },
    },
    select: { id: true, symbol: true, status: true },
    orderBy: { generatedAt: 'asc' },
  });

  let closed = 0;
  const seenSymbols = new Set<string>();

  for (const sig of openSignals) {
    if (sig.status === 'NEW') {
      await prisma.signal.update({ where: { id: sig.id }, data: { status: 'EXPIRED' } });
      continue;
    }

    if (seenSymbols.has(sig.symbol)) continue;
    seenSymbols.add(sig.symbol);

    const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);
    if (pos.inspectable && pos.hasPosition) {
      const result = await closeActivePositionForSymbol(sig.symbol, exchange);
      if (result.closed) {
        closed++;
        console.log(`${logPrefix} 🔴 Fechado ${sig.symbol}: ${result.message}`);
      } else {
        console.warn(`${logPrefix} ⚠️ Falha ao fechar ${sig.symbol}: ${result.message}`);
      }
    }

    await prisma.$executeRaw`
      UPDATE "Signal"
      SET status = 'EXPIRED'
      WHERE "strategyId" = ${strategyId}
        AND symbol = ${sig.symbol}
        AND status = 'IN_PROGRESS'
    `;
  }

  return closed;
}

function strengthForRank(rank: number): number {
  return Math.min(98, Math.max(82, 90 - rank));
}

/**
 * Rotação total: fecha tudo no ciclo, recompra top N do último scan Scanner 1.
 */
export async function runScanner1Top8Pipeline(options?: {
  force?: boolean;
  logPrefix?: string;
}): Promise<Scanner1Top8Result> {
  const logPrefix = options?.logPrefix ?? '[Scanner1 Top8]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER1_TOP8_STRATEGY_NAME },
  });

  if (!strategy) {
    return { status: 'skipped', reason: 'Estratégia SCANNER1_TOP8 não encontrada (correr seed/sync)' };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const topN = Math.min(20, Math.max(1, Math.floor(Number(params.topN ?? 8))));
  const stopLossPct = Number(params.stopLossPct ?? 0.05);
  const closeAfterHours = Number(params.closeAfterHours ?? 4);
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);

  const scan = await getTopRankedUniverseScanRows(UNIVERSE_CODE_SCANNER_1_ABOVE_MA200, topN);
  if (!scan.ok) {
    return { status: 'skipped', reason: scan.reason };
  }

  const lastRunId = await getLastProcessedRunId();
  if (!options?.force && lastRunId === scan.runId) {
    return {
      status: 'skipped',
      reason: `Scan ${scan.runId} já processado neste ciclo`,
    };
  }

  console.log(
    `${logPrefix} Rotação total — top ${topN} (scan ${scan.scannedAt.toISOString()}) → ${scan.rows.map((r) => r.symbol).join(', ')}`
  );

  const closed = await closeAllStrategyPositions(strategy.id, exchange, logPrefix);

  if (!strategyAllowsAutoExecuteDirection('BUY', params as Record<string, unknown>)) {
    await setLastProcessedRunId(scan.runId);
    return {
      status: 'done',
      runId: scan.runId,
      closed,
      signalsCreated: 0,
      executed: 0,
      symbols: scan.rows.map((r) => r.symbol),
    };
  }

  const startedAt = new Date();
  let signalsCreated = 0;

  for (const row of scan.rows) {
    const entryPrice = row.close;
    if (!(entryPrice > 0)) continue;

    const stopLoss = entryPrice * (1 - stopLossPct);
    const strength = strengthForRank(row.rank);

    const created = await prisma.signal.create({
      data: {
        symbol: row.symbol,
        direction: 'BUY',
        timeframe: '4h',
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
          setup: 'scanner1_top8_rotation',
          rank: row.rank,
          pctFromMa: row.pctFromMa,
          scanRunId: scan.runId,
          scannedAt: scan.scannedAt.toISOString(),
          stopLossPct,
          closeAfterHours,
          rotation: 'full',
          executionProfile: `SL -${(stopLossPct * 100).toFixed(0)}% | rotação total a cada scan (4h) | top ${topN} Scanner 1`,
        }),
      },
    });
    signalsCreated++;
    console.log(
      `${logPrefix} 🟢 #${row.rank} ${row.symbol} @ ${entryPrice} (força ${strength}) id=${created.id}`
    );
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 80);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  await setLastProcessedRunId(scan.runId);

  console.log(
    `${logPrefix} Concluído: ${closed} fechados, ${signalsCreated} sinais, ${executed} executados`
  );

  return {
    status: 'done',
    runId: scan.runId,
    closed,
    signalsCreated,
    executed,
    symbols: scan.rows.map((r) => r.symbol),
  };
}
