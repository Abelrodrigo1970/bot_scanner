/**

 * Rotação Scanner 1 — fecha tudo e recompra no próximo scan (4 h).

 * SCANNER1_TOP8: ranks 1,2,5–8 (excl. #3 #4). SCANNER1_TOP5: ranks 1–4 LONG + SHORT saídas.

 */



import { prisma } from './db';

import {
  UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
  UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H,
  isTickerRankUniverseScan,
} from './symbolUniverseDefaults';

import {
  buildScanItemsWithPreviousDelta,
  getLatestUniverseScanPair,
  getTopRankedUniverseScanRows,
  type UniverseScanRowSnapshot,
} from './universeScanPersistence';

import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';

import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

import { strategyAllowsAutoExecuteDirection } from './signalEngine';



export const SCANNER1_TOP8_STRATEGY_NAME = 'SCANNER1_TOP8' as const;

export const SCANNER1_TOP5_STRATEGY_NAME = 'SCANNER1_TOP5' as const;



const ROTATION_DEFAULT_UNIVERSE: Record<string, string> = {
  [SCANNER1_TOP8_STRATEGY_NAME]: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
  [SCANNER1_TOP5_STRATEGY_NAME]: UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H,
};

function resolveRotationUniverseCode(strategyName: string, params: Scanner1Top8Params): string {
  const fromParams = params.universeCode?.trim();
  if (fromParams) return fromParams;
  return ROTATION_DEFAULT_UNIVERSE[strategyName] ?? UNIVERSE_CODE_SCANNER_1_ABOVE_MA200;
}

const LAST_RUN_SETTING_KEYS: Record<string, string> = {
  [SCANNER1_TOP8_STRATEGY_NAME]: 'SCANNER1_TOP8_LAST_RUN_ID',
  [SCANNER1_TOP5_STRATEGY_NAME]: 'SCANNER1_TOP5_LAST_RUN_ID',
};



export type Scanner1Top8Params = {
  topN?: number;
  scanTopN?: number;
  excludeRanks?: number[];
  universeCode?: string;
  stopLossPct?: number;

  closeAfterHours?: number;

  exchange?: 'binance' | 'bybit';

  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  /** SHORT nas moedas que saíram do top (Scanner 2 Top 4). */
  shortOnExit?: boolean;
  shortStopLossPct?: number;
  shortCloseAfterHours?: number;

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

      longSignals?: number;

      shortSignals?: number;

      exited?: string[];

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



async function getLastProcessedRunId(key: string): Promise<string | null> {

  const row = await prisma.appSetting.findUnique({ where: { key } });

  return row?.value ?? null;

}



async function setLastProcessedRunId(key: string, runId: string): Promise<void> {

  await prisma.appSetting.upsert({

    where: { key },

    create: { key, value: runId },

    update: { value: runId },

  });

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



type ScanRow = { rank: number; symbol: string; close: number; pctFromMa: number };

function rankUniverseRows(
  universeCode: string,
  rows: UniverseScanRowSnapshot[],
  previousRows?: UniverseScanRowSnapshot[] | null
): ScanRow[] {
  const ordered = isTickerRankUniverseScan(universeCode)
    ? rows
    : [...rows].sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));
  return buildScanItemsWithPreviousDelta(ordered, previousRows ?? null);
}

function priceInRankedRows(rows: ScanRow[], symbol: string, fallback: number): number | null {
  const row = rows.find((r) => r.symbol === symbol);
  return row?.close ?? fallback;
}

export function filterScanRowsForTop8(params: Scanner1Top8Params, rows: ScanRow[]): ScanRow[] {

  const excludeList =

    params.excludeRanks !== undefined ? params.excludeRanks : ([3, 4] as number[]);

  const exclude = new Set(excludeList.map((r) => Math.floor(Number(r))));

  const defaultTopN = excludeList.length === 0 ? 4 : 6;

  const topN = Math.min(20, Math.max(1, Math.floor(Number(params.topN ?? defaultTopN))));

  const filtered = exclude.size ? rows.filter((r) => !exclude.has(r.rank)) : rows;

  return filtered.slice(0, topN);

}



function resolveScanFetchN(params: Scanner1Top8Params): number {

  const scanTopN = Math.floor(Number(params.scanTopN ?? 4));

  const topN = Math.floor(Number(params.topN ?? (params.excludeRanks?.length === 0 ? 4 : 6)));

  const exclude = params.excludeRanks !== undefined ? params.excludeRanks : [3, 4];

  const maxExcluded = exclude.length ? Math.max(...exclude.map((r) => Math.floor(Number(r)))) : 0;

  return Math.min(20, Math.max(1, scanTopN, topN + exclude.length, maxExcluded));

}



export async function runScannerRotationPipeline(options: {

  strategyName: string;

  force?: boolean;

  logPrefix?: string;

}): Promise<Scanner1Top8Result> {

  const logPrefix = options.logPrefix ?? `[${options.strategyName}]`;

  const lastRunKey = LAST_RUN_SETTING_KEYS[options.strategyName];

  if (!lastRunKey) {

    return { status: 'skipped', reason: `Estratégia ${options.strategyName} sem chave de rotação` };

  }



  const strategy = await prisma.strategy.findUnique({

    where: { name: options.strategyName },

  });



  if (!strategy) {

    return {

      status: 'skipped',

      reason: `Estratégia ${options.strategyName} não encontrada (correr seed/sync)`,

    };

  }

  if (!strategy.isActive) {

    return { status: 'skipped', reason: 'Estratégia inactiva' };

  }



  const params = parseParams(strategy.params);

  const excludeRanks = params.excludeRanks !== undefined ? params.excludeRanks : [3, 4];

  const scanFetchN = resolveScanFetchN(params);

  const stopLossPct = Number(params.stopLossPct ?? 0.03);

  const closeAfterHours = Number(params.closeAfterHours ?? 4);

  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const universeCode = resolveRotationUniverseCode(options.strategyName, params);

  const shortOnExit = params.shortOnExit === true;
  const shortStopLossPct = Number(params.shortStopLossPct ?? 0.25);
  const shortCloseAfterHours = Number(params.shortCloseAfterHours ?? closeAfterHours);

  let scanRunId: string;
  let scanScannedAt: Date;
  let rankedRows: ScanRow[];
  let exitedRows: ScanRow[] = [];

  if (shortOnExit) {
    const pair = await getLatestUniverseScanPair(universeCode);
    if (!pair.current) {
      return { status: 'skipped', reason: 'Nenhum scan gravado na BD' };
    }
    rankedRows = rankUniverseRows(universeCode, pair.current.rows, pair.previous?.rows).slice(
      0,
      scanFetchN
    );
    scanRunId = pair.current.id;
    scanScannedAt = pair.current.scannedAt;

    if (pair.previous) {
      const prevRanked = rankUniverseRows(universeCode, pair.previous.rows, null).slice(
        0,
        scanFetchN
      );
      const prevSelected = filterScanRowsForTop8(params, prevRanked);
      const currSymbols = new Set(
        filterScanRowsForTop8(params, rankedRows).map((r) => r.symbol)
      );
      exitedRows = prevSelected.filter((r) => !currSymbols.has(r.symbol));
    }
  } else {
    const scan = await getTopRankedUniverseScanRows(universeCode, scanFetchN);
    if (!scan.ok) {
      return { status: 'skipped', reason: scan.reason };
    }
    rankedRows = scan.rows;
    scanRunId = scan.runId;
    scanScannedAt = scan.scannedAt;
  }

  const selectedRows = filterScanRowsForTop8(params, rankedRows);

  if (selectedRows.length === 0) {

    return { status: 'skipped', reason: 'Nenhum símbolo após filtro de ranks' };

  }



  const lastRunId = await getLastProcessedRunId(lastRunKey);

  if (!options?.force && lastRunId === scanRunId) {

    return {

      status: 'skipped',

      reason: `Scan ${scanRunId} já processado neste ciclo`,

    };

  }



  const excludeLabel = excludeRanks.length ? `excl. ranks ${excludeRanks.join(',')}` : 'sem exclusões';

  console.log(
    `${logPrefix} Rotação total — ${selectedRows.length} LONG${shortOnExit ? ` | ${exitedRows.length} SHORT saídas` : ''} (${universeCode}, scan top ${scanFetchN}, ${excludeLabel}) ${scanScannedAt.toISOString()} → ${selectedRows.map((r) => `#${r.rank} ${r.symbol}`).join(', ')}`
  );
  if (exitedRows.length) {
    console.log(`${logPrefix} 🔻 Saídas → SHORT: ${exitedRows.map((r) => r.symbol).join(', ')}`);
  }



  const closed = await closeAllStrategyPositions(strategy.id, exchange, logPrefix);

  const allowBuy = strategyAllowsAutoExecuteDirection('BUY', params as Record<string, unknown>);
  const allowSell = strategyAllowsAutoExecuteDirection('SELL', params as Record<string, unknown>);

  if (!allowBuy && !allowSell) {

    await setLastProcessedRunId(lastRunKey, scanRunId);

    return {

      status: 'done',

      runId: scanRunId,

      closed,

      signalsCreated: 0,

      longSignals: 0,

      shortSignals: 0,

      exited: exitedRows.map((r) => r.symbol),

      executed: 0,

      symbols: selectedRows.map((r) => r.symbol),

    };

  }



  const startedAt = new Date();

  let longSignals = 0;
  let shortSignals = 0;

  const longSetupTag =
    options.strategyName === SCANNER1_TOP5_STRATEGY_NAME
      ? 'scanner2_top4_rotation'
      : 'scanner1_top8_rotation';



  if (allowBuy) {
    for (const row of selectedRows) {

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
            setup: longSetupTag,
            leg: 'long_rotation',
            universeCode,
            rank: row.rank,

            pctFromMa: row.pctFromMa,

            scanRunId: scanRunId,

            scannedAt: scanScannedAt.toISOString(),

            stopLossPct,

            closeAfterHours,

            rotation: 'full',

            excludeRanks,

            executionProfile: `LONG rotação | SL -${(stopLossPct * 100).toFixed(0)}% | 4h | ${selectedRows.length} pos.${excludeRanks.length ? ` (excl. ranks ${excludeRanks.join(',')})` : ''}`,

          }),

        },

      });

      longSignals++;

      console.log(

        `${logPrefix} 🟢 LONG #${row.rank} ${row.symbol} @ ${entryPrice} (força ${strength}) id=${created.id}`

      );

    }
  }

  if (allowSell && shortOnExit) {
    for (const row of exitedRows) {
      const entryPrice = priceInRankedRows(rankedRows, row.symbol, row.close);
      if (!(entryPrice != null && entryPrice > 0)) continue;

      const stopLoss = entryPrice * (1 + shortStopLossPct);
      const strength = 88;

      const created = await prisma.signal.create({
        data: {
          symbol: row.symbol,
          direction: 'SELL',
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
            setup: 'scanner2_top4_exit_short',
            leg: 'exit_short',
            universeCode,
            rankBefore: row.rank,
            pctFromMa: row.pctFromMa,
            scanRunId: scanRunId,
            scannedAt: scanScannedAt.toISOString(),
            stopLossPct: shortStopLossPct,
            closeAfterHours: shortCloseAfterHours,
            rotation: 'full_long_exit_short',
            excludeRanks,
            executionProfile: `SHORT saída top 4 | SL +${(shortStopLossPct * 100).toFixed(0)}% | ${shortCloseAfterHours}h`,
          }),
        },
      });

      shortSignals++;
      console.log(
        `${logPrefix} 🔻 SHORT saída ${row.symbol} @ ${entryPrice} (força ${strength}) id=${created.id}`
      );
    }
  }

  const signalsCreated = longSignals + shortSignals;



  const minStrength = Number(params.autoExecuteMinStrength ?? 80);

  const executed = await autoExecuteNewSignalsForStrategy({

    strategy,

    startedAt,

    minStrength,

    logPrefix,

  });



  await setLastProcessedRunId(lastRunKey, scanRunId);



  console.log(

    `${logPrefix} Concluído: ${closed} fechados, ${signalsCreated} sinais (${longSignals} LONG, ${shortSignals} SHORT), ${executed} executados`

  );



  return {

    status: 'done',

    runId: scanRunId,

    closed,

    signalsCreated,

    longSignals,

    shortSignals,

    exited: exitedRows.map((r) => r.symbol),

    executed,

    symbols: [...selectedRows.map((r) => r.symbol), ...exitedRows.map((r) => r.symbol)],

  };

}



export async function runScanner1Top8Pipeline(options?: {

  force?: boolean;

  logPrefix?: string;

}): Promise<Scanner1Top8Result> {

  return runScannerRotationPipeline({

    strategyName: SCANNER1_TOP8_STRATEGY_NAME,

    force: options?.force,

    logPrefix: options?.logPrefix ?? '[Scanner1 Top6]',

  });

}



export async function runScanner1Top5Pipeline(options?: {

  force?: boolean;

  logPrefix?: string;

}): Promise<Scanner1Top8Result> {

  return runScannerRotationPipeline({

    strategyName: SCANNER1_TOP5_STRATEGY_NAME,

    force: options?.force,

    logPrefix: options?.logPrefix ?? '[Scanner2 Top8]',

  });

}


