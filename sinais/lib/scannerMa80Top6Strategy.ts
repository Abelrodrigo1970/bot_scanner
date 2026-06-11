/**
 * Scanner 5 — Top 6 acima SMA80 (1d), rotação diária.
 * Compra ranks 1, 4, 5, 6, 7, 8 (exclui #2 e #3 do top 8). SL -5%.
 */

import { prisma } from './db';
import { UNIVERSE_CODE_SCANNER_5_ABOVE_MA80_1D } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';
import { strategyAllowsAutoExecuteDirection } from './signalEngine';
import {
  filterScanRowsForTop8,
  type Scanner1Top8Params,
} from './scanner1Top8Strategy';

export const SCANNER_MA80_TOP6_STRATEGY_NAME = 'SCANNER_MA80_TOP6' as const;
const LAST_RUN_DAY_KEY = 'SCANNER_MA80_TOP6_LAST_RUN_DAY';

export type ScannerMa80Top6Params = Scanner1Top8Params;

export type ScannerMa80Top6Result =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      runId: string;
      closed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): ScannerMa80Top6Params {
  try {
    return raw ? (JSON.parse(raw) as ScannerMa80Top6Params) : {};
  } catch {
    return {};
  }
}

async function getLastProcessedDay(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: LAST_RUN_DAY_KEY } });
  return row?.value ?? null;
}

async function setLastProcessedDay(dayUtc: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: LAST_RUN_DAY_KEY },
    create: { key: LAST_RUN_DAY_KEY, value: dayUtc },
    update: { value: dayUtc },
  });
}

function utcDayKey(iso: string): string {
  return iso.slice(0, 10);
}

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
      const result = await closeActivePositionForSymbol(sig.symbol, exchange, {
        rotationClose: true,
      });
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

function resolveScanFetchN(params: ScannerMa80Top6Params): number {
  const scanTopN = Math.floor(Number(params.scanTopN ?? 8));
  const topN = Math.floor(Number(params.topN ?? 6));
  const exclude = params.excludeRanks ?? [2, 3];
  const maxExcluded = exclude.length ? Math.max(...exclude.map((r) => Math.floor(Number(r)))) : 0;
  return Math.min(20, Math.max(1, scanTopN, topN + exclude.length, maxExcluded));
}

/**
 * Rotação total diária: fecha tudo e recompra top 6 (excl. ranks 2–3) do Scanner 5.
 */
export async function runScannerMa80Top6Pipeline(options?: {
  force?: boolean;
  logPrefix?: string;
}): Promise<ScannerMa80Top6Result> {
  const logPrefix = options?.logPrefix ?? '[Scanner5 MA80 Top6]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER_MA80_TOP6_STRATEGY_NAME },
  });

  if (!strategy) {
    return { status: 'skipped', reason: 'Estratégia SCANNER_MA80_TOP6 não encontrada (correr seed/sync)' };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const topN = Math.min(20, Math.max(1, Math.floor(Number(params.topN ?? 6))));
  const excludeRanks = params.excludeRanks ?? [2, 3];
  const scanFetchN = resolveScanFetchN(params);
  const stopLossPct = Number(params.stopLossPct ?? 0.05);
  const closeAfterHours = Number(params.closeAfterHours ?? 24);
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);

  const scan = await getTopRankedUniverseScanRows(UNIVERSE_CODE_SCANNER_5_ABOVE_MA80_1D, scanFetchN);
  if (!scan.ok) {
    return { status: 'skipped', reason: scan.reason };
  }

  const selectedRows = filterScanRowsForTop8(
    { ...params, topN, excludeRanks },
    scan.rows
  );
  if (selectedRows.length === 0) {
    return { status: 'skipped', reason: 'Nenhum símbolo após filtro de ranks' };
  }

  const scanDay = utcDayKey(scan.scannedAt.toISOString());
  const lastDay = await getLastProcessedDay();
  if (!options?.force && lastDay === scanDay) {
    return {
      status: 'skipped',
      reason: `Rotação já feita hoje (UTC ${scanDay})`,
    };
  }

  console.log(
    `${logPrefix} Rotação diária — ${selectedRows.length} pos. (scan top ${scanFetchN}, excl. ranks ${excludeRanks.join(',')}) ${scan.scannedAt.toISOString()} → ${selectedRows.map((r) => `#${r.rank} ${r.symbol}`).join(', ')}`
  );

  const closed = await closeAllStrategyPositions(strategy.id, exchange, logPrefix);

  if (!strategyAllowsAutoExecuteDirection('BUY', params as Record<string, unknown>)) {
    await setLastProcessedDay(scanDay);
    return {
      status: 'done',
      runId: scan.runId,
      closed,
      signalsCreated: 0,
      executed: 0,
      symbols: selectedRows.map((r) => r.symbol),
    };
  }

  const startedAt = new Date();
  let signalsCreated = 0;

  for (const row of selectedRows) {
    const entryPrice = row.close;
    if (!(entryPrice > 0)) continue;

    const stopLoss = entryPrice * (1 - stopLossPct);
    const strength = strengthForRank(row.rank);

    const created = await prisma.signal.create({
      data: {
        symbol: row.symbol,
        direction: 'BUY',
        timeframe: '1d',
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
          setup: 'scanner_ma80_top6_rotation',
          rank: row.rank,
          pctFromMa: row.pctFromMa,
          scanRunId: scan.runId,
          scannedAt: scan.scannedAt.toISOString(),
          stopLossPct,
          closeAfterHours,
          rotation: 'full',
          excludeRanks,
          executionProfile: `SL -${(stopLossPct * 100).toFixed(0)}% | rotação diária | ${selectedRows.length} pos. MA80 1d (excl. ranks ${excludeRanks.join(',')})`,
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

  await setLastProcessedDay(scanDay);

  console.log(
    `${logPrefix} Concluído: ${closed} fechados, ${signalsCreated} sinais, ${executed} executados`
  );

  return {
    status: 'done',
    runId: scan.runId,
    closed,
    signalsCreated,
    executed,
    symbols: selectedRows.map((r) => r.symbol),
  };
}
