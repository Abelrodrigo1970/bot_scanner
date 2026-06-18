/**
 * Scanner 6 — SHORT rank #1, entradas 0h/8h/12h/20h PT, fecho 12h (SL +7%).
 */

import { prisma } from './db';
import { UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H } from './symbolUniverseDefaults';
import { getTopRankedUniverseScanRows } from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';
import { strategyAllowsAutoExecuteDirection } from './signalEngine';

export const SCANNER_S6_SHORT_LEADER_12H_STRATEGY_NAME = 'SCANNER_S6_SHORT_LEADER_12H' as const;
const LAST_RUN_SETTING_KEY = 'SCANNER_S6_SHORT_LEADER_12H_LAST_RUN_ID';
const TZ = 'Europe/Lisbon';

export type ScannerS6ShortLeader12hParams = {
  rankMin?: number;
  rankMax?: number;
  allowedEntryHoursPt?: number[];
  stopLossPct?: number;
  closeAfterHours?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type ScannerS6ShortLeader12hResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      runId: string;
      entrySlotPt: number;
      timedClosed: number;
      signalsCreated: number;
      executed: number;
      symbol?: string;
    };

function parseParams(raw: string | null): ScannerS6ShortLeader12hParams {
  try {
    return raw ? (JSON.parse(raw) as ScannerS6ShortLeader12hParams) : {};
  } catch {
    return {};
  }
}

function entrySlotPt(iso: string | Date): number {
  const h = +new Date(iso).toLocaleString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false,
  });
  return Math.round(h / 4) * 4 % 24;
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
 * Após cada scan do Scanner 6: fecha posições com idade ≥ closeAfterHours;
 * se slot PT ∈ allowedEntryHoursPt, abre SHORT no rank #1.
 */
export async function runScannerS6ShortLeader12hPipeline(options?: {
  force?: boolean;
  logPrefix?: string;
}): Promise<ScannerS6ShortLeader12hResult> {
  const logPrefix = options?.logPrefix ?? '[Scanner6 Short Leader 12h]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER_S6_SHORT_LEADER_12H_STRATEGY_NAME },
  });

  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia SCANNER_S6_SHORT_LEADER_12H não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const rankMin = Math.max(1, Math.floor(Number(params.rankMin ?? 1)));
  const rankMax = Math.max(rankMin, Math.floor(Number(params.rankMax ?? 1)));
  const allowedHours = params.allowedEntryHoursPt ?? [0, 8, 12, 20];
  const stopLossPct = Number(params.stopLossPct ?? 0.07);
  const closeAfterHours = Number(params.closeAfterHours ?? 12);
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);

  const scan = await getTopRankedUniverseScanRows(UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H, 5);
  if (!scan.ok) {
    return { status: 'skipped', reason: scan.reason };
  }

  const timedClosed = await closeTimedOutPositions(
    strategy.id,
    closeAfterHours,
    exchange,
    logPrefix
  );

  const slot = entrySlotPt(scan.scannedAt);
  const lastRunId = await getLastProcessedRunId();
  if (!options?.force && lastRunId === scan.runId) {
    return {
      status: 'skipped',
      reason: `Scan ${scan.runId} já processado (slot ${slot}h PT)`,
    };
  }

  await setLastProcessedRunId(scan.runId);

  if (!allowedHours.includes(slot)) {
    return {
      status: 'done',
      runId: scan.runId,
      entrySlotPt: slot,
      timedClosed,
      signalsCreated: 0,
      executed: 0,
    };
  }

  const leader = scan.rows.find((r) => r.rank >= rankMin && r.rank <= rankMax);
  if (!leader) {
    return {
      status: 'skipped',
      reason: `Sem rank #${rankMin} no scan`,
    };
  }

  const existingOpen = await prisma.signal.findFirst({
    where: {
      strategyId: strategy.id,
      symbol: leader.symbol,
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { id: true },
  });
  if (existingOpen) {
    console.log(`${logPrefix} ⏭️ Já existe sinal aberto em ${leader.symbol} — ignorado`);
    return {
      status: 'done',
      runId: scan.runId,
      entrySlotPt: slot,
      timedClosed,
      signalsCreated: 0,
      executed: 0,
      symbol: leader.symbol,
    };
  }

  if (!strategyAllowsAutoExecuteDirection('SELL', params as Record<string, unknown>)) {
    console.log(`${logPrefix} ⏭️ Auto-exec SELL desactivada — sem novo sinal`);
    return {
      status: 'done',
      runId: scan.runId,
      entrySlotPt: slot,
      timedClosed,
      signalsCreated: 0,
      executed: 0,
      symbol: leader.symbol,
    };
  }

  const entryPrice = leader.close;
  if (!(entryPrice > 0)) {
    return { status: 'skipped', reason: 'Preço de entrada inválido' };
  }

  const stopLoss = entryPrice * (1 + stopLossPct);
  const strength = 92;

  console.log(
    `${logPrefix} 🔻 SHORT #${leader.rank} ${leader.symbol} @ ${entryPrice} (slot ${slot}h PT, hold ${closeAfterHours}h, pctMA ${leader.pctFromMa.toFixed(1)}%)`
  );

  const startedAt = new Date();
  await prisma.signal.create({
    data: {
      symbol: leader.symbol,
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
        setup: 'scanner_s6_short_leader_12h',
        rank: leader.rank,
        pctFromMa: leader.pctFromMa,
        scanRunId: scan.runId,
        scannedAt: scan.scannedAt.toISOString(),
        entrySlotPt: slot,
        stopLossPct,
        closeAfterHours,
        executionProfile: `SHORT rank #1 | Scanner 6 SMA80 4h | SL +${(stopLossPct * 100).toFixed(0)}% | fecho ${closeAfterHours}h | slots ${allowedHours.join(',')}h PT`,
      }),
    },
  });

  const minStrength = Number(params.autoExecuteMinStrength ?? 80);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${timedClosed} fechados por tempo, 1 sinal SHORT, ${executed} executados`
  );

  return {
    status: 'done',
    runId: scan.runId,
    entrySlotPt: slot,
    timedClosed,
    signalsCreated: 1,
    executed,
    symbol: leader.symbol,
  };
}
