/**
 * Scanner 3 — RSI Flip 1h
 * - Entra no universo (RSI>75, novo vs scan anterior) → LONG, SL -5%
 * - RSI cai abaixo de 70 → inverte para SHORT, SL +5%
 * - Volta a entrar no scanner → inverte de novo para LONG
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateRSI, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_3_RSI75_1H } from './symbolUniverseDefaults';
import {
  buildScanItemsWithPreviousDelta,
  getLatestUniverseScanPair,
} from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const SCANNER3_RSI_FLIP_1H_STRATEGY_NAME = 'SCANNER3_RSI_FLIP_1H' as const;
const LAST_RUN_SETTING_KEY = 'SCANNER3_RSI_FLIP_1H_LAST_RUN_ID';

export type Scanner3RsiFlip1hParams = {
  /** RSI mínimo para estar no Scanner 3 (alinhado com o scan). */
  entryRsiMin?: number;
  /** Abaixo deste RSI inverte para SHORT. */
  flipShortRsiBelow?: number;
  stopLossPct?: number;
  /** Segurança: expira sinais IN_PROGRESS após N horas (0 = sem fecho por tempo). */
  closeAfterHours?: number;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type Scanner3RsiFlip1hResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      runId: string;
      longCreated: number;
      shortCreated: number;
      flippedClosed: number;
      executed: number;
      longSymbols: string[];
      shortSymbols: string[];
    };

function parseParams(raw: string | null): Scanner3RsiFlip1hParams {
  try {
    return raw ? (JSON.parse(raw) as Scanner3RsiFlip1hParams) : {};
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

async function fetchClosedRsi1h(symbol: string, period = 14): Promise<number | null> {
  try {
    const candles = await fetchCandles(symbol, '1h', period + 80);
    if (candles.length < period + 2) return null;
    const closed = candles.slice(0, -1);
    return calculateRSI(getCloses(closed), period);
  } catch {
    return null;
  }
}

async function expireOpenSignals(
  strategyId: string,
  symbol: string,
  exchange: 'binance' | 'bybit',
  logPrefix: string
): Promise<boolean> {
  const pos = await inspectActivePositionForSymbol(symbol, exchange);
  let closed = false;
  if (pos.inspectable && pos.hasPosition) {
    const result = await closeActivePositionForSymbol(symbol, exchange, { rotationClose: true });
    closed = !!result.closed;
    if (result.closed) {
      console.log(`${logPrefix} 🔄 Fechado ${symbol} para flip: ${result.message}`);
    } else {
      console.warn(`${logPrefix} ⚠️ Falha ao fechar ${symbol}: ${result.message}`);
    }
  }

  await prisma.signal.updateMany({
    where: { strategyId, symbol, status: { in: ['NEW', 'IN_PROGRESS'] } },
    data: { status: 'EXPIRED' },
  });

  return closed;
}

/**
 * Após cada scan Scanner 3 (1h): LONG nos novos; SHORT se RSI < flipShortRsiBelow.
 */
export async function runScanner3RsiFlip1hPipeline(options?: {
  force?: boolean;
  logPrefix?: string;
}): Promise<Scanner3RsiFlip1hResult> {
  const logPrefix = options?.logPrefix ?? '[Scanner3 RSI Flip 1h]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: SCANNER3_RSI_FLIP_1H_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia SCANNER3_RSI_FLIP_1H não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  const params = parseParams(strategy.params);
  const flipShortRsiBelow = Number(params.flipShortRsiBelow ?? 70);
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.05));
  const closeAfterHours = Math.max(0, Math.floor(Number(params.closeAfterHours ?? 72)));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;
  const allowSell = params.sellEnabled !== false && params.allowSell !== false;

  const pair = await getLatestUniverseScanPair(UNIVERSE_CODE_SCANNER_3_RSI75_1H);
  if (!pair.current) {
    return { status: 'skipped', reason: 'Sem scan Scanner 3 (RSI 1h) na BD' };
  }

  const lastRunId = await getLastProcessedRunId();
  if (!options?.force && lastRunId === pair.current.id) {
    return { status: 'skipped', reason: `Scan ${pair.current.id} já processado` };
  }

  await setLastProcessedRunId(pair.current.id);

  const items = buildScanItemsWithPreviousDelta(pair.current.rows, pair.previous?.rows);

  const startedAt = new Date();
  let longCreated = 0;
  let shortCreated = 0;
  let flippedClosed = 0;
  const longSymbols: string[] = [];
  const shortSymbols: string[] = [];

  // ── 1) LONG: novos no scanner (precisa de scan anterior) ─────────────────
  if (allowBuy && pair.previous) {
    for (const row of items) {
      if (!row.isNewInUniverse) continue;
      if (!(row.close > 0)) continue;

      const openSame = await prisma.signal.findFirst({
        where: {
          strategyId: strategy.id,
          symbol: row.symbol,
          direction: 'BUY',
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
        select: { id: true },
      });
      if (openSame) continue;

      const closed = await expireOpenSignals(strategy.id, row.symbol, exchange, logPrefix);
      if (closed) flippedClosed++;

      const entryPrice = row.close;
      const stopLoss = entryPrice * (1 - stopLossPct);
      const rsi = row.pctFromMa; // no scan RSI_ABOVE, pctFromMa = RSI

      console.log(
        `${logPrefix} 🟢 LONG ${row.symbol} @ ${entryPrice} (entrou no Scanner 3, RSI ${rsi.toFixed(1)}, SL -${(stopLossPct * 100).toFixed(0)}%)`
      );

      await prisma.signal.create({
        data: {
          symbol: row.symbol,
          direction: 'BUY',
          timeframe: '1h',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice,
          stopLoss,
          target1: null,
          target2: null,
          target3: null,
          strength: Math.min(95, Math.max(80, Math.round(70 + (rsi - 75)))),
          status: 'NEW',
          extraInfo: JSON.stringify({
            setup: 'scanner3_rsi_flip_long_entry',
            rsi: Number(rsi.toFixed(2)),
            scanRunId: pair.current.id,
            scannedAt: pair.current.scannedAt.toISOString(),
            stopLossPct,
            closeAfterHours: closeAfterHours || null,
            flipShortRsiBelow,
            executionProfile: `LONG ao entrar Scanner 3 (RSI>75) | SL -${(stopLossPct * 100).toFixed(0)}% | inverte SHORT se RSI < ${flipShortRsiBelow}`,
          }),
        },
      });

      longCreated++;
      longSymbols.push(row.symbol);
    }
  } else if (!pair.previous) {
    console.log(`${logPrefix} Sem scan anterior — sem LONGs de entrada neste ciclo`);
  }

  // ── 2) SHORT: inverte LONGs abertos quando RSI < flipShortRsiBelow ────────
  if (allowSell) {
    const openLongs = await prisma.signal.findMany({
      where: {
        strategyId: strategy.id,
        direction: 'BUY',
        status: { in: ['NEW', 'IN_PROGRESS'] },
      },
      select: { symbol: true },
    });

    const candidates = new Set(openLongs.map((s) => s.symbol));

    for (const symbol of candidates) {
      const openShort = await prisma.signal.findFirst({
        where: {
          strategyId: strategy.id,
          symbol,
          direction: 'SELL',
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
        select: { id: true },
      });
      if (openShort) continue;

      const rsi = await fetchClosedRsi1h(symbol);
      if (rsi == null || rsi >= flipShortRsiBelow) continue;

      const candles = await fetchCandles(symbol, '1h', 3).catch(() => []);
      const closed = candles.length >= 2 ? candles.slice(0, -1) : candles;
      const entryPrice = closed.length ? closed[closed.length - 1].close : 0;
      if (!(entryPrice > 0)) continue;

      const closedPos = await expireOpenSignals(strategy.id, symbol, exchange, logPrefix);
      if (closedPos) flippedClosed++;

      const stopLoss = entryPrice * (1 + stopLossPct);

      console.log(
        `${logPrefix} 🔴 SHORT ${symbol} @ ${entryPrice} (RSI ${rsi.toFixed(1)} < ${flipShortRsiBelow}, SL +${(stopLossPct * 100).toFixed(0)}%)`
      );

      await prisma.signal.create({
        data: {
          symbol,
          direction: 'SELL',
          timeframe: '1h',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice,
          stopLoss,
          target1: null,
          target2: null,
          target3: null,
          strength: Math.min(95, Math.max(80, Math.round(85 + (flipShortRsiBelow - rsi) / 2))),
          status: 'NEW',
          extraInfo: JSON.stringify({
            setup: 'scanner3_rsi_flip_short',
            rsi: Number(rsi.toFixed(2)),
            flipShortRsiBelow,
            scanRunId: pair.current.id,
            scannedAt: pair.current.scannedAt.toISOString(),
            stopLossPct,
            closeAfterHours: closeAfterHours || null,
            executionProfile: `SHORT quando RSI < ${flipShortRsiBelow} | SL +${(stopLossPct * 100).toFixed(0)}% | volta a LONG ao reentrar Scanner 3`,
          }),
        },
      });

      shortCreated++;
      shortSymbols.push(symbol);
    }
  }

  // ── 3) Fecho por tempo (opcional) ────────────────────────────────────────
  if (closeAfterHours > 0) {
    const cutoff = new Date(Date.now() - closeAfterHours * 3600000);
    const stale = await prisma.signal.findMany({
      where: {
        strategyId: strategy.id,
        status: 'IN_PROGRESS',
        generatedAt: { lt: cutoff },
      },
      select: { id: true, symbol: true },
    });
    for (const sig of stale) {
      const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);
      if (pos.inspectable && pos.hasPosition) {
        await closeActivePositionForSymbol(sig.symbol, exchange, { timedClose: true });
      }
      await prisma.signal.update({ where: { id: sig.id }, data: { status: 'EXPIRED' } });
    }
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 80);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: LONG ${longCreated} | SHORT ${shortCreated} | flips fechados ${flippedClosed} | auto-exec ${executed}`
  );

  return {
    status: 'done',
    runId: pair.current.id,
    longCreated,
    shortCreated,
    flippedClosed,
    executed,
    longSymbols,
    shortSymbols,
  };
}
