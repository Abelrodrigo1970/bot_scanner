/**
 * rsi_vendido LONG — Scanner 6 (SMA80 4h) top N.
 * Entrada (novo no top N): só BUY se fecho 4h > EMA21 + 0,8%.
 * Reentrada (ainda no top N, sem posição): só BUY se fecho 4h > EMA21 + 0,8%.
 * Saída: sai do top N OU fecho 4h < EMA21.
 * SL −15% (segurança); sem TP — gestão por scanner + EMA21.
 */

import { prisma } from './db';
import { fetchCandles } from './marketData';
import { calculateLastEMA, getCloses } from './indicators';
import { UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H } from './symbolUniverseDefaults';
import {
  buildScanItemsWithPreviousDelta,
  getLatestUniverseScanPair,
} from './universeScanPersistence';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const RSI_VENDIDO_STRATEGY_NAME = 'RSI_VENDIDO_4H' as const;

/** Distância mínima acima da EMA21 para BUY ao entrar no top N / reentrar (0,8%). */
export const RSI_VENDIDO_EMA_REENTRY_MIN_PCT_DEFAULT = 0.008;

/** Intervalo default do cron rsi_vendido (horas, Lisboa). */
export const RSI_VENDIDO_RUN_EVERY_HOURS_DEFAULT = 2;

/**
 * Só corre no primeiro slot de 15 min do bloco de N horas (Europe/Lisbon).
 * Ex.: N=2 → 00:00–00:14, 02:00–02:14, 04:00–04:14, …
 */
export function shouldRunRsiVendidoSchedule(
  now: Date = new Date(),
  everyHours: number = RSI_VENDIDO_RUN_EVERY_HOURS_DEFAULT
): { ok: boolean; reason?: string } {
  const hours = Math.max(0, Math.floor(everyHours));
  if (hours <= 0) return { ok: true };

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { ok: true };
  }
  if (hour % hours !== 0) {
    return {
      ok: false,
      reason: `rsi_vendido só de ${hours}em${hours}h Lisboa (hora ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`,
    };
  }
  if (minute >= 15) {
    return {
      ok: false,
      reason: `rsi_vendido já passou o slot deste bloco de ${hours}h (minuto ${minute})`,
    };
  }
  return { ok: true };
}

export type RsiVendidoParams = {
  universeTopN?: number;
  /** @deprecated Prefer universeTopN */
  topN?: number;
  chartTimeframe?: string;
  /** EMA de saída / filtro de compra (4h). Default 21. */
  emaExitPeriod?: number;
  /**
   * Fecho 4h tem de estar **acima** da EMA por este % para BUY
   * (entrada no top N e reentrada). Ex.: 0.008 = +0,8%.
   */
  emaReentryMinPctAbove?: number;
  /** Corre o pipeline no máximo de N em N horas (Europe/Lisbon). 0 = sempre. Default 2. */
  runEveryHours?: number;
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
  emaReentryMinPctAbove: number;
  topN: number;
  barCloseTs: number;
  scannerRsi: number | null;
  scannerRank: number | null;
  scanRunId: string | null;
  trigger: 'enter_scanner' | 'ema21_reentry';
  logPrefix: string;
}): Promise<void> {
  const stopLoss = opts.entryPrice * (1 - opts.stopLossPct);
  const strength =
    opts.scannerRsi != null ? strengthForScannerRsi(opts.scannerRsi) : 80;
  const minAbovePct = opts.emaReentryMinPctAbove * 100;

  console.log(
    `${opts.logPrefix} 🟢 LONG ${opts.symbol} @ ${opts.entryPrice} (${opts.trigger} | Scanner 6 | 4h EMA${opts.emaExitPeriod} +${minAbovePct.toFixed(1)}% | SL −${(opts.stopLossPct * 100).toFixed(0)}%)`
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
        setup: 'rsi_vendido_s6_4h_ema21',
        universe: UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H,
        universeTopN: opts.topN,
        barCloseTs: opts.barCloseTs,
        trigger: opts.trigger,
        scannerRsi: opts.scannerRsi,
        scannerRank: opts.scannerRank,
        scanRunId: opts.scanRunId,
        emaExitPeriod: opts.emaExitPeriod,
        emaReentryMinPctAbove: opts.emaReentryMinPctAbove,
        stopLossPct: opts.stopLossPct,
        chartTimeframe: opts.chartTimeframe,
        executionProfile: `LONG Scanner 6 (SMA80 4h) top ${opts.topN} | TF ${opts.chartTimeframe} | entra/reentra só com fecho > EMA${opts.emaExitPeriod} +${minAbovePct.toFixed(1)}% | sai ao sair do scanner ou fecho < EMA${opts.emaExitPeriod} | SL −${(opts.stopLossPct * 100).toFixed(0)}%`,
      }),
    },
  });
}

export async function runRsiVendidoPipeline(options?: {
  logPrefix?: string;
  /** Ignora runEveryHours (útil em /api/cron/run-rsi-vendido manual). */
  force?: boolean;
}): Promise<RsiVendidoResult> {
  const logPrefix = options?.logPrefix ?? '[rsi_vendido S6 4h EMA21]';

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
  const runEveryHours = Math.max(
    0,
    Math.floor(Number(params.runEveryHours ?? RSI_VENDIDO_RUN_EVERY_HOURS_DEFAULT))
  );
  if (!options?.force) {
    const slot = shouldRunRsiVendidoSchedule(new Date(), runEveryHours);
    if (!slot.ok) {
      return { status: 'skipped', reason: slot.reason ?? 'fora do horário' };
    }
  }

  const topN = Math.max(
    1,
    Math.min(120, Math.floor(Number(params.universeTopN ?? params.topN ?? 40)))
  );
  const chartTimeframe = String(params.chartTimeframe ?? '4h');
  const emaExitPeriod = Math.max(2, Math.floor(Number(params.emaExitPeriod ?? 21)));
  const emaReentryMinPctAbove = Math.max(
    0,
    Number(params.emaReentryMinPctAbove ?? RSI_VENDIDO_EMA_REENTRY_MIN_PCT_DEFAULT)
  );
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.15));
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const allowBuy = params.buyEnabled !== false && params.allowBuy !== false;

  const pair = await getLatestUniverseScanPair(UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H);
  if (!pair.current || pair.current.rows.length === 0) {
    return {
      status: 'skipped',
      reason: 'Scanner 6 vazio — correr run-universe-scans',
    };
  }

  const allItems = buildScanItemsWithPreviousDelta(
    pair.current.rows,
    pair.previous?.rows ?? null
  );
  const items = allItems.slice(0, topN);
  const universeSet = new Set(items.map((r) => r.symbol));
  const itemBySymbol = new Map(items.map((r) => [r.symbol, r]));
  // «Novo» = entrou no topN (não no scan completo de 80).
  const prevTopSet = new Set(
    (pair.previous?.rows ?? []).slice(0, topN).map((r) => r.symbol)
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

  console.log(
    `${logPrefix} Scanner 6 top ${topN}: ${universeSet.size} | abertos ${openLongSet.size} | prevScan=${pair.previous ? 'yes' : 'no'} | EMA${emaExitPeriod} +${(emaReentryMinPctAbove * 100).toFixed(1)}%`
  );

  const startedAt = new Date();
  let leftScannerClosed = 0;
  let emaClosed = 0;
  let signalsCreated = 0;
  let reentries = 0;
  const hitSymbols: string[] = [];
  const closedSymbols: string[] = [];

  const minStrength = Number(params.autoExecuteMinStrength ?? 70);

  // 0) Auto-exec NEW pendentes ANTES de expirar por saída
  let executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix: `${logPrefix} [retry]`,
  });

  const openAfterRetry = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { symbol: true },
  });
  openLongSet.clear();
  for (const s of openAfterRetry) openLongSet.add(s.symbol);

  // 1) Saiu do Scanner 6 → fecha LONG
  for (const symbol of [...openLongSet]) {
    if (universeSet.has(symbol)) continue;
    await closeOpenLong(strategy.id, symbol, exchange, logPrefix, 'saiu Scanner 6');
    leftScannerClosed++;
    closedSymbols.push(symbol);
    openLongSet.delete(symbol);
  }

  // 2) Ainda no scanner: fecho 4h < EMA21 → fecha; acima EMA21+0,8% → entra/reentra
  const toCheck = new Set<string>([...universeSet, ...openLongSet]);

  for (const symbol of toCheck) {
    const bar = await fetchClosed4hWithEma(symbol, chartTimeframe, emaExitPeriod);
    if (!bar) continue;

    const inUniverse = universeSet.has(symbol);
    const hasOpen = openLongSet.has(symbol);
    const row = itemBySymbol.get(symbol) ?? null;
    const scannerRsi = row != null && Number.isFinite(row.pctFromMa) ? row.pctFromMa : null;
    const entryMinClose = bar.ema * (1 + emaReentryMinPctAbove);

    // Saída EMA: fecho 4h abaixo da EMA21
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

    // Filtro obrigatório: fecho 4h > EMA21 × (1 + 0,8%)
    const aboveEntryBand = bar.close > entryMinClose;
    const isNew = !!pair.previous && !prevTopSet.has(symbol);

    if (!aboveEntryBand) {
      if (isNew) {
        const distPct = bar.ema > 0 ? ((bar.close / bar.ema - 1) * 100).toFixed(2) : '?';
        console.log(
          `${logPrefix} ⏭ ${symbol} entrou top${topN} mas fecho 4h não está > EMA${emaExitPeriod}+${(emaReentryMinPctAbove * 100).toFixed(1)}% (fecho=${bar.close.toFixed(6)} ema=${bar.ema.toFixed(6)} dist=${distPct}%)`
        );
      }
      continue;
    }

    // Sem scan anterior não há «entrou no topN» fiável — só gere saídas neste ciclo.
    if (!pair.previous) continue;

    // Entrada: acabou de entrar no top N (+ filtro EMA acima)
    // Reentrada: já estava no top N, sem posição (+ filtro EMA acima)
    const enterNew = isNew;
    const reenter = !isNew;

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
      emaReentryMinPctAbove,
      topN,
      barCloseTs: bar.barCloseTs,
      scannerRsi,
      scannerRank: row?.rank ?? null,
      scanRunId: pair.current.id,
      trigger: enterNew ? 'enter_scanner' : 'ema21_reentry',
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

  executed += await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${leftScannerClosed} saíram S6, ${emaClosed} EMA21, ${signalsCreated} LONG (${reentries} reentradas), ${executed} executados`
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
