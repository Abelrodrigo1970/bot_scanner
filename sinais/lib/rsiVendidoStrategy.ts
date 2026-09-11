/**
 * rsi_vendido LONG — Scanner 7 (RSI 1d > 69).
 * Entrada: símbolo entra no Scanner 7 (novo no universo) e fecho 4h ≥ EMA70.
 * Saída: sai do Scanner 7 OU fecho 4h cruza abaixo da EMA70.
 * Reentrada: ainda no Scanner 7 e fecho 4h cruza acima da EMA70.
 * SL −15% (segurança); sem TP — gestão por scanner + EMA.
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateLastEMA, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_7_RSI_ABOVE_69_1D } from './symbolUniverseDefaults';
import {
  buildScanItemsWithPreviousDelta,
  getLatestUniverseScanPair,
} from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RSI_VENDIDO_STRATEGY_NAME = 'RSI_VENDIDO_4H' as const;

export type RsiVendidoParams = {
  universeTopN?: number;
  /** @deprecated Prefer universeTopN */
  topN?: number;
  chartTimeframe?: string;
  /** EMA de saída / reentrada (4h). */
  emaExitPeriod?: number;
  stopLossPct?: number;
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
      leftScannerClosed: number;
      emaClosed: number;
      signalsCreated: number;
      reentries: number;
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

function strengthForScannerRsi(rsi: number): number {
  if (rsi >= 85) return 94;
  if (rsi >= 80) return 90;
  if (rsi >= 75) return 86;
  if (rsi >= 72) return 82;
  return 78;
}

async function closeOpenLong(
  strategyId: string,
  symbol: string,
  exchange: 'binance' | 'bybit',
  logPrefix: string,
  reason: string
): Promise<boolean> {
  const pos = await inspectActivePositionForSymbol(symbol, exchange);
  let closed = false;
  if (pos.inspectable && pos.hasPosition) {
    const result = await closeActivePositionForSymbol(symbol, exchange, {
      rotationClose: true,
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

type Closed4hBar = {
  close: number;
  prevClose: number;
  ema: number;
  prevEma: number;
  barCloseTs: number;
};

async function fetchClosed4hWithEma(
  symbol: string,
  chartTimeframe: string,
  emaPeriod: number
): Promise<Closed4hBar | null> {
  const need = Math.max(emaPeriod + 10, 90);
  let candles;
  try {
    candles = await fetchCandles(symbol, chartTimeframe as '4h', need);
  } catch {
    return null;
  }
  if (candles.length < emaPeriod + 3) return null;

  const closed = candles.slice(0, -1);
  const closes = getCloses(closed);
  if (closes.length < emaPeriod + 2) return null;

  const ema = calculateLastEMA(closes, emaPeriod);
  const prevEma = calculateLastEMA(closes.slice(0, -1), emaPeriod);
  if (ema == null || prevEma == null) return null;

  const close = closes[closes.length - 1]!;
  const prevClose = closes[closes.length - 2]!;
  const bar = closed[closed.length - 1]!;
  if (!(close > 0) || !(prevClose > 0)) return null;

  return {
    close,
    prevClose,
    ema,
    prevEma,
    barCloseTs: bar.timestamp,
  };
}

async function createLongSignal(opts: {
  strategyId: string;
  strategyDisplayName: string;
  symbol: string;
  entryPrice: number;
  stopLossPct: number;
  chartTimeframe: string;
  emaExitPeriod: number;
  topN: number;
  barCloseTs: number;
  scannerRsi: number | null;
  scannerRank: number | null;
  scanRunId: string | null;
  trigger: 'enter_scanner' | 'ema70_cross_up';
  logPrefix: string;
}): Promise<void> {
  const stopLoss = opts.entryPrice * (1 - opts.stopLossPct);
  const strength =
    opts.scannerRsi != null ? strengthForScannerRsi(opts.scannerRsi) : 80;

  console.log(
    `${opts.logPrefix} 🟢 LONG ${opts.symbol} @ ${opts.entryPrice} (${opts.trigger} | Scanner 7 | 4h EMA${opts.emaExitPeriod} | SL −${(opts.stopLossPct * 100).toFixed(0)}%)`
  );

  await prisma.signal.create({
    data: {
      symbol: opts.symbol,
      direction: 'BUY',
      timeframe: opts.chartTimeframe,
      strategyId: opts.strategyId,
      strategyName: opts.strategyDisplayName,
      entryPrice: opts.entryPrice,
      stopLoss,
      target1: null,
      target2: null,
      target3: null,
      strength,
      status: 'NEW',
      extraInfo: JSON.stringify({
        setup: 'rsi_vendido_s7_4h_ema70',
        universe: UNIVERSE_CODE_SCANNER_7_RSI_ABOVE_69_1D,
        universeTopN: opts.topN,
        barCloseTs: opts.barCloseTs,
        trigger: opts.trigger,
        scannerRsi: opts.scannerRsi,
        scannerRank: opts.scannerRank,
        scanRunId: opts.scanRunId,
        emaExitPeriod: opts.emaExitPeriod,
        stopLossPct: opts.stopLossPct,
        chartTimeframe: opts.chartTimeframe,
        executionProfile: `LONG Scanner 7 (RSI 1d>69) top ${opts.topN} | TF ${opts.chartTimeframe} | entra ao entrar no scanner (fecho ≥ EMA${opts.emaExitPeriod}) | sai ao sair do scanner ou fecho < EMA${opts.emaExitPeriod} | reentra se ainda no scanner e fecho cruza > EMA${opts.emaExitPeriod} | SL −${(opts.stopLossPct * 100).toFixed(0)}%`,
      }),
    },
  });
}

export async function runRsiVendidoPipeline(options?: {
  logPrefix?: string;
}): Promise<RsiVendidoResult> {
  const logPrefix = options?.logPrefix ?? '[rsi_vendido S7 4h]';

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
    Math.min(120, Math.floor(Number(params.universeTopN ?? params.topN ?? 80)))
  );
  const chartTimeframe = String(params.chartTimeframe ?? '4h');
  const emaExitPeriod = Math.max(2, Math.floor(Number(params.emaExitPeriod ?? 70)));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.15));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;

  const pair = await getLatestUniverseScanPair(UNIVERSE_CODE_SCANNER_7_RSI_ABOVE_69_1D);
  if (!pair.current || pair.current.rows.length === 0) {
    return {
      status: 'skipped',
      reason: 'Scanner 7 vazio — correr run-universe-scans',
    };
  }

  const allItems = buildScanItemsWithPreviousDelta(
    pair.current.rows,
    pair.previous?.rows ?? null
  );
  const items = allItems.slice(0, topN);
  const universeSet = new Set(items.map((r) => r.symbol));
  const itemBySymbol = new Map(items.map((r) => [r.symbol, r]));

  const openLongs = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { symbol: true },
  });
  const openLongSet = new Set(openLongs.map((s) => s.symbol));

  console.log(
    `${logPrefix} Scanner 7 top ${topN}: ${universeSet.size} | abertos ${openLongSet.size} | prevScan=${pair.previous ? 'yes' : 'no'}`
  );

  const startedAt = new Date();
  let leftScannerClosed = 0;
  let emaClosed = 0;
  let signalsCreated = 0;
  let reentries = 0;
  const hitSymbols: string[] = [];
  const closedSymbols: string[] = [];

  // 1) Saiu do Scanner 7 → fecha LONG
  for (const symbol of [...openLongSet]) {
    if (universeSet.has(symbol)) continue;
    await closeOpenLong(strategy.id, symbol, exchange, logPrefix, 'saiu Scanner 7');
    leftScannerClosed++;
    closedSymbols.push(symbol);
    openLongSet.delete(symbol);
  }

  // 2) Ainda no scanner: fecho 4h < EMA70 → fecha; cruzamento ↑ → reentra; novo no scanner → entra
  const toCheck = new Set<string>([...universeSet, ...openLongSet]);

  for (const symbol of toCheck) {
    const bar = await fetchClosed4hWithEma(symbol, chartTimeframe, emaExitPeriod);
    if (!bar) continue;

    const inUniverse = universeSet.has(symbol);
    const hasOpen = openLongSet.has(symbol);
    const row = itemBySymbol.get(symbol) ?? null;
    const scannerRsi = row != null && Number.isFinite(row.pctFromMa) ? row.pctFromMa : null;

    // Saída EMA: fecho 4h abaixo da EMA
    if (hasOpen && inUniverse && bar.close < bar.ema) {
      await closeOpenLong(
        strategy.id,
        symbol,
        exchange,
        logPrefix,
        `fecho 4h < EMA${emaExitPeriod} (${bar.close.toFixed(6)} < ${bar.ema.toFixed(6)})`
      );
      emaClosed++;
      closedSymbols.push(symbol);
      openLongSet.delete(symbol);
    }

    if (!allowBuy) continue;

    const hasOpenNow = openLongSet.has(symbol);
    if (hasOpenNow || !inUniverse) continue;

    const reclaimEma = bar.prevClose < bar.prevEma && bar.close >= bar.ema;
    const isNew = !!row?.isNewInUniverse && !!pair.previous;
    // Entrada ao entrar no scanner: exige fecho ≥ EMA70 (senão reentra no reclaim)
    const enterNew = isNew && bar.close >= bar.ema;
    // Reentrada: ainda no scanner e fecho volta acima da EMA70
    const reenter = !isNew && reclaimEma;

    if (!enterNew && !reenter) continue;

    // Dedup mesmo barCloseTs
    const recent = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        generatedAt: { gte: new Date(Date.now() - 48 * 3600000) },
      },
      select: { extraInfo: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (recent?.extraInfo) {
      try {
        const ex = JSON.parse(recent.extraInfo) as { barCloseTs?: number };
        if (ex.barCloseTs === bar.barCloseTs) continue;
      } catch {
        /* ignore */
      }
    }

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

    await createLongSignal({
      strategyId: strategy.id,
      strategyDisplayName: strategy.displayName,
      symbol,
      entryPrice: bar.close,
      stopLossPct,
      chartTimeframe,
      emaExitPeriod,
      topN,
      barCloseTs: bar.barCloseTs,
      scannerRsi,
      scannerRank: row?.rank ?? null,
      scanRunId: pair.current.id,
      trigger: enterNew ? 'enter_scanner' : 'ema70_cross_up',
      logPrefix,
    });

    signalsCreated++;
    if (reenter) reentries++;
    hitSymbols.push(symbol);
    openLongSet.add(symbol);
  }

  if (!pair.previous) {
    console.log(`${logPrefix} Sem scan anterior — LONGs de «entrar no scanner» só no próximo ciclo`);
  }

  const minStrength = Number(params.autoExecuteMinStrength ?? 70);
  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${leftScannerClosed} saíram S7, ${emaClosed} EMA, ${signalsCreated} LONG (${reentries} reentradas), ${executed} executados`
  );

  return {
    status: 'done',
    leftScannerClosed,
    emaClosed,
    signalsCreated,
    reentries,
    executed,
    symbols: hitSymbols,
    closedSymbols,
  };
}
