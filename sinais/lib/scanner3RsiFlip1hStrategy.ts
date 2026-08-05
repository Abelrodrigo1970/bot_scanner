/**
 * Scanner 3 — RSI Flip (scan 1h, trades 15m)
 * - Entra no universo 1h (RSI>75, novo, ranks 6–14) e RSI 15m ≥ 70 → LONG 15m, SL -5%, segurança 72h
 * - RSI 15m cruza abaixo de 70 → inverte para SHORT 15m, SL +5%, fecho 24h
 * - Volta a entrar no scanner (ranks 6–14) → inverte de novo para LONG
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateRSISeries, getCloses } from './indicators';
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
  /** RSI mínimo para estar no Scanner 3 (alinhado com o scan 1h). */
  entryRsiMin?: number;
  /** Rank mínimo no Scanner 3 (|RSI| desc) para LONG de entrada. */
  minScannerRank?: number;
  /** Rank máximo no Scanner 3 (|RSI| desc) para LONG de entrada. */
  maxScannerRank?: number;
  /** Abaixo deste RSI (velas de trade) inverte para SHORT. */
  flipShortRsiBelow?: number;
  /** Timeframe das velas para entrada, flip e sinais (15m). */
  chartTimeframe?: string;
  rsiPeriod?: number;
  stopLossPct?: number;
  /** Segurança LONG: expira IN_PROGRESS após N horas (0 = sem fecho por tempo). */
  closeAfterHours?: number;
  /** Fecho por tempo dos SHORT (0 = sem fecho por tempo). */
  shortCloseAfterHours?: number;
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

async function fetchClosedRsi(
  symbol: string,
  timeframe: string,
  period = 14
): Promise<number | null> {
  const pair = await fetchClosedRsiPair(symbol, timeframe, period);
  return pair?.now ?? null;
}

/** RSI da última vela fechada e da anterior (para detectar cruzamento). */
async function fetchClosedRsiPair(
  symbol: string,
  timeframe: string,
  period = 14
): Promise<{ prev: number; now: number } | null> {
  try {
    const candles = await fetchCandles(symbol, timeframe, period + 80);
    if (candles.length < period + 3) return null;
    const closed = candles.slice(0, -1);
    const series = calculateRSISeries(getCloses(closed), period);
    if (series.length < 2) return null;
    const prev = series[series.length - 2];
    const now = series[series.length - 1];
    if (!Number.isFinite(prev) || !Number.isFinite(now)) return null;
    return { prev, now };
  } catch {
    return null;
  }
}

async function fetchClosedCandleClose(symbol: string, timeframe: string): Promise<number | null> {
  try {
    const candles = await fetchCandles(symbol, timeframe, 3);
    if (!candles.length) return null;
    const closed = candles.length >= 2 ? candles.slice(0, -1) : candles;
    const close = closed[closed.length - 1]?.close;
    return close != null && close > 0 ? close : null;
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
 * Após scan Scanner 3 (1h): LONG nos novos; SHORT se RSI trade < flipShortRsiBelow.
 * mode `flips_only`: só verifica flips (cron 15m); entradas LONG só no cron 1h.
 */
export async function runScanner3RsiFlip1hPipeline(options?: {
  force?: boolean;
  logPrefix?: string;
  mode?: 'full' | 'flips_only';
}): Promise<Scanner3RsiFlip1hResult> {
  const logPrefix = options?.logPrefix ?? '[Scanner3 RSI Flip 15m]';
  const mode = options?.mode ?? 'full';

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
  const chartTimeframe = String(params.chartTimeframe ?? '15m');
  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? 14)));
  const flipShortRsiBelow = Number(params.flipShortRsiBelow ?? 70);
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.05));
  const closeAfterHours = Math.max(0, Math.floor(Number(params.closeAfterHours ?? 72)));
  const shortCloseAfterHours = Math.max(
    0,
    Math.floor(Number(params.shortCloseAfterHours ?? 24))
  );
  const minScannerRank = Math.max(1, Math.floor(Number(params.minScannerRank ?? 6)));
  const maxScannerRank = Math.max(
    minScannerRank,
    Math.floor(Number(params.maxScannerRank ?? 14))
  );
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;
  const allowSell = params.sellEnabled !== false && params.allowSell !== false;

  const pair = await getLatestUniverseScanPair(UNIVERSE_CODE_SCANNER_3_RSI75_1H);
  if (!pair.current) {
    return { status: 'skipped', reason: 'Sem scan Scanner 3 (RSI 1h) na BD' };
  }

  if (mode === 'full') {
    const lastRunId = await getLastProcessedRunId();
    if (!options?.force && lastRunId === pair.current.id) {
      return { status: 'skipped', reason: `Scan ${pair.current.id} já processado` };
    }
    await setLastProcessedRunId(pair.current.id);
  }

  const items =
    mode === 'full'
      ? buildScanItemsWithPreviousDelta(pair.current.rows, pair.previous?.rows)
      : [];

  const startedAt = new Date();
  let longCreated = 0;
  let shortCreated = 0;
  let flippedClosed = 0;
  const longSymbols: string[] = [];
  const shortSymbols: string[] = [];

  // ── 1) LONG: novos no scanner 1h ranks min–max (precisa de scan anterior) ─
  if (mode === 'full' && allowBuy && pair.previous) {
    for (const row of items) {
      if (!row.isNewInUniverse) continue;
      if (row.rank < minScannerRank || row.rank > maxScannerRank) continue;

      // Só entra LONG se o RSI 15m ainda está ≥ limiar (senão flip imediato).
      const rsiTrade = await fetchClosedRsi(row.symbol, chartTimeframe, rsiPeriod);
      if (rsiTrade == null || rsiTrade < flipShortRsiBelow) {
        console.log(
          `${logPrefix} ⏭️ Skip LONG ${row.symbol} rank #${row.rank}: RSI ${chartTimeframe} ${rsiTrade?.toFixed(1) ?? 'n/a'} < ${flipShortRsiBelow}`
        );
        continue;
      }

      const entryPrice = await fetchClosedCandleClose(row.symbol, chartTimeframe);
      if (entryPrice == null) continue;

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

      const stopLoss = entryPrice * (1 - stopLossPct);
      const rsi = row.pctFromMa; // scan 1h: pctFromMa = RSI

      console.log(
        `${logPrefix} 🟢 LONG ${row.symbol} @ ${entryPrice} (${chartTimeframe}, rank #${row.rank} Scanner 3 1h RSI ${rsi.toFixed(1)}, trade RSI ${rsiTrade.toFixed(1)}, SL -${(stopLossPct * 100).toFixed(0)}%)`
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
          strength: Math.min(95, Math.max(80, Math.round(70 + (rsi - 75)))),
          status: 'NEW',
          extraInfo: JSON.stringify({
            setup: 'scanner3_rsi_flip_long_entry',
            rsi: Number(rsi.toFixed(2)),
            rsiTrade: Number(rsiTrade.toFixed(2)),
            scannerRank: row.rank,
            minScannerRank,
            maxScannerRank,
            scanRunId: pair.current.id,
            scannedAt: pair.current.scannedAt.toISOString(),
            stopLossPct,
            closeAfterHours: closeAfterHours || null,
            flipShortRsiBelow,
            chartTimeframe,
            executionProfile: `LONG ${chartTimeframe} ao entrar Scanner 3 ranks ${minScannerRank}–${maxScannerRank} (RSI 1h>75, RSI ${chartTimeframe}≥${flipShortRsiBelow}) | SL -${(stopLossPct * 100).toFixed(0)}% | inverte SHORT se RSI ${chartTimeframe} cruza abaixo de ${flipShortRsiBelow}`,
          }),
        },
      });

      longCreated++;
      longSymbols.push(row.symbol);
    }
  } else if (mode === 'full' && !pair.previous) {
    console.log(`${logPrefix} Sem scan anterior — sem LONGs de entrada neste ciclo`);
  }

  // ── 2) SHORT: só quando RSI trade cruza abaixo de flipShortRsiBelow ──────
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
    // Não inverter LONGs criados neste mesmo ciclo (evita flip em 1–2s).
    for (const s of longSymbols) candidates.delete(s);

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

      const rsiPair = await fetchClosedRsiPair(symbol, chartTimeframe, rsiPeriod);
      // Cruzamento: estava ≥ limiar e fechou abaixo.
      if (
        rsiPair == null ||
        !(rsiPair.prev >= flipShortRsiBelow && rsiPair.now < flipShortRsiBelow)
      ) {
        continue;
      }
      const rsi = rsiPair.now;

      const entryPrice = await fetchClosedCandleClose(symbol, chartTimeframe);
      if (entryPrice == null) continue;

      const closedPos = await expireOpenSignals(strategy.id, symbol, exchange, logPrefix);
      if (closedPos) flippedClosed++;

      const stopLoss = entryPrice * (1 + stopLossPct);

      console.log(
        `${logPrefix} 🔴 SHORT ${symbol} @ ${entryPrice} (${chartTimeframe} RSI ${rsiPair.prev.toFixed(1)}→${rsi.toFixed(1)} cruzou < ${flipShortRsiBelow}, SL +${(stopLossPct * 100).toFixed(0)}%, fecho ${shortCloseAfterHours}h)`
      );

      await prisma.signal.create({
        data: {
          symbol,
          direction: 'SELL',
          timeframe: chartTimeframe,
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
            rsiPrev: Number(rsiPair.prev.toFixed(2)),
            flipShortRsiBelow,
            scanRunId: pair.current.id,
            scannedAt: pair.current.scannedAt.toISOString(),
            stopLossPct,
            closeAfterHours: shortCloseAfterHours || null,
            chartTimeframe,
            crossover: `RSI ${chartTimeframe} cruzou abaixo de ${flipShortRsiBelow}`,
            executionProfile: `SHORT ${chartTimeframe} quando RSI cruza < ${flipShortRsiBelow} | SL +${(stopLossPct * 100).toFixed(0)}% | fecho ${shortCloseAfterHours}h | volta a LONG ao reentrar Scanner 3 ranks ${minScannerRank}–${maxScannerRank}`,
          }),
        },
      });

      shortCreated++;
      shortSymbols.push(symbol);
    }
  }

  // ── 3) Fecho por tempo (LONG e SHORT com horários distintos) ────────────
  const strategyId = strategy.id;
  async function closeTimed(
    direction: 'BUY' | 'SELL',
    hours: number
  ): Promise<void> {
    if (!(hours > 0)) return;
    const cutoff = new Date(Date.now() - hours * 3600000);
    const stale = await prisma.signal.findMany({
      where: {
        strategyId,
        direction,
        status: 'IN_PROGRESS',
        generatedAt: { lt: cutoff },
      },
      select: { id: true, symbol: true, generatedAt: true, extraInfo: true },
    });
    for (const sig of stale) {
      let closeHours = hours;
      try {
        const extra = sig.extraInfo ? (JSON.parse(sig.extraInfo) as Record<string, unknown>) : {};
        if (extra.closeAfterHours != null) closeHours = Number(extra.closeAfterHours);
      } catch {
        /* keep default */
      }
      if (!(closeHours > 0)) continue;
      if (Date.now() - sig.generatedAt.getTime() < closeHours * 3600000) continue;

      const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);
      if (pos.inspectable && pos.hasPosition) {
        await closeActivePositionForSymbol(sig.symbol, exchange, { timedClose: true });
      }
      await prisma.signal.update({ where: { id: sig.id }, data: { status: 'EXPIRED' } });
    }
  }

  await closeTimed('BUY', closeAfterHours);
  await closeTimed('SELL', shortCloseAfterHours);

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
