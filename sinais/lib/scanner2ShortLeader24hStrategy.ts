/**
 * Scanner 2 — SHORT ranks #1–#2 (top subidas 24h), fecho 24h, SL +40%.
 * Mean-reversion pós-pump; filtro pump ≥50%.
 */

import { prisma } from './db';
import { UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const SCANNER2_SHORT_LEADER_24H_STRATEGY_NAME = 'SCANNER2_SHORT_LEADER_24H' as const;
const LAST_RUN_SETTING_KEY = 'SCANNER2_SHORT_LEADER_24H_LAST_RUN_ID';
const TZ = 'Europe/Lisbon';

export type Scanner2ShortLeader24hParams = {
  rankMin?: number;
  rankMax?: number;
  /** Subida 24h mínima (pctFromMa no scan = variação 24h). 0 = sem filtro. */
  minPumpPct24h?: number;
  /** Horas PT em que não abre novo SHORT (ex.: 10–14). */
  blockedEntryHoursPt?: number[];
  stopLossPct?: number;
  closeAfterHours?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Scanner2ShortLeader24hResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      runId: string;
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
    };

function parseParams(raw: string | null): Scanner2ShortLeader24hParams {
  try {
    return raw ? (JSON.parse(raw) as Scanner2ShortLeader24hParams) : {};
  } catch {
    return {};
  }
}

export function getLisbonHour(date: string | Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false,
  }).format(new Date(date));
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? n : 0;
}

function strengthForRank(rank: number): number {
  return rank === 1 ? 92 : 88;
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
 * Após cada scan do Scanner 2: fecha posições ≥ closeAfterHours;
 * abre SHORT nos ranks #1–#2 (com filtro de pump e hora PT).
 */
export async function runScanner2ShortLeader24hPipeline(options?: {
  force?: boolean;
  logPrefix?: string;
}): Promise<Scanner2ShortLeader24hResult> {
  const logPrefix = options?.logPrefix ?? '[Scanner2 Short Leader 24h]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER2_SHORT_LEADER_24H_STRATEGY_NAME },
  });

  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia SCANNER2_SHORT_LEADER_24H não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const rankMin = Math.max(1, Math.floor(Number(params.rankMin ?? 1)));
  const rankMax = Math.max(rankMin, Math.floor(Number(params.rankMax ?? 2)));
  const minPumpPct = Number(params.minPumpPct24h ?? 50);
  const blockedHours = new Set(params.blockedEntryHoursPt ?? []);
  const stopLossPct = Number(params.stopLossPct ?? 0.4);
  const closeAfterHours = Number(params.closeAfterHours ?? 24);
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);

  const scan = await getTopRankedUniverseScanRows(UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H, rankMax);
  if (!scan.ok) {
    return { status: 'skipped', reason: scan.reason };
  }

  const timedClosed = await closeTimedOutPositions(
    strategy.id,
    closeAfterHours,
    exchange,
    logPrefix
  );

  const now = new Date();
  const lisbonHour = getLisbonHour(now);
  const lastRunId = await getLastProcessedRunId();
  if (!options?.force && lastRunId === scan.runId) {
    return {
      status: 'skipped',
      reason: `Scan ${scan.runId} já processado`,
    };
  }

  await setLastProcessedRunId(scan.runId);

  if (blockedHours.has(lisbonHour)) {
    console.log(
      `${logPrefix} Hora ${lisbonHour}h PT bloqueada — sem novos SHORT (bloqueadas: ${[...blockedHours].sort((a, b) => a - b).join(',')}h)`
    );
    return {
      status: 'done',
      runId: scan.runId,
      timedClosed,
      signalsCreated: 0,
      executed: 0,
      symbols: [],
    };
  }

  const candidates = scan.rows.filter(
    (r) => r.rank >= rankMin && r.rank <= rankMax && r.pctFromMa >= minPumpPct
  );

  if (candidates.length === 0) {
    console.log(
      `${logPrefix} Sem ranks ${rankMin}–${rankMax} com pump ≥${minPumpPct}% — sem sinal`
    );
    return {
      status: 'done',
      runId: scan.runId,
      timedClosed,
      signalsCreated: 0,
      executed: 0,
      symbols: [],
    };
  }

  const startedAt = new Date();
  let signalsCreated = 0;
  const symbols: string[] = [];

  for (const row of candidates) {
    const existingInProgress = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol: row.symbol,
        status: 'IN_PROGRESS',
      },
      select: { id: true },
    });
    if (existingInProgress) {
      console.log(`${logPrefix} ⏭️ IN_PROGRESS em ${row.symbol} — ignorado`);
      continue;
    }

    const entryPrice = row.close;
    if (!(entryPrice > 0)) continue;

    const stopLoss = entryPrice * (1 + stopLossPct);
    const strength = strengthForRank(row.rank);

    console.log(
      `${logPrefix} 🔻 SHORT #${row.rank} ${row.symbol} @ ${entryPrice} (pump ${row.pctFromMa.toFixed(1)}%, ${lisbonHour}h PT, hold ${closeAfterHours}h, SL +${(stopLossPct * 100).toFixed(0)}%)`
    );

    await prisma.signal.updateMany({
      where: { strategyId: strategy.id, symbol: row.symbol, status: 'NEW' },
      data: { status: 'EXPIRED' },
    });

    await prisma.signal.create({
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
          setup: 'scanner2_short_leader_24h',
          rank: row.rank,
          pumpPct24h: row.pctFromMa,
          scanRunId: scan.runId,
          scannedAt: scan.scannedAt.toISOString(),
          pipelineAt: now.toISOString(),
          lisbonHourPt: lisbonHour,
          minPumpPct24h: minPumpPct,
          stopLossPct,
          closeAfterHours,
          executionProfile: `SHORT ranks #${rankMin}–#${rankMax} | Scanner 2 top subidas 24h | pump ≥${minPumpPct}% | SL +${(stopLossPct * 100).toFixed(0)}% | fecho ${closeAfterHours}h`,
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
    `${logPrefix} Concluído: ${timedClosed} fechados por tempo, ${signalsCreated} sinal(is) SHORT, ${executed} executados`
  );

  return {
    status: 'done',
    runId: scan.runId,
    timedClosed,
    signalsCreated,
    executed,
    symbols,
  };
}
