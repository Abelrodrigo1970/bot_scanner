/**
 * Volume Spike 1h — LONG
 * Entrada: fecho 1h ≥ +5% vs fecho ant. E volume ≥ 12× média das 10 velas anteriores.
 * Universo: top N Bybit por turnover 24h.
 * Saída: SL −5% | TP +95% (100% pos.) | fecho timed às 30h.
 * Filtro BTC: se fecho 1h BTC < −1,5% vs ant. → sem novas ordens + fecha todos os trades.
 * Cron: 1.º quarto de hora Lisboa (vela 1h acabou de fechar).
 */

import { prisma } from './db';
import { fetchCandles, fetchTopVolume24hTickers, type Candle } from './marketData';
import { autoExecuteNewSignalsForStrategy, resolveStrategyExchange } from './autoExecuteNewSignals';
import { closeActivePositionForSymbol, inspectActivePositionForSymbol } from './tradingExecutor';

export const VOLUME_SPIKE_1H_STRATEGY_NAME = 'VOLUME_SPIKE_1H' as const;
export const VOLUME_SPIKE_1H_BTC_SYMBOL = 'BTCUSDT' as const;

export const VOLUME_SPIKE_1H_PRICE_MOVE_PCT_DEFAULT = 0.05;
export const VOLUME_SPIKE_1H_VOL_MULT_DEFAULT = 12;
export const VOLUME_SPIKE_1H_VOL_LOOKBACK_DEFAULT = 10;
export const VOLUME_SPIKE_1H_STOP_LOSS_PCT_DEFAULT = 0.05;
export const VOLUME_SPIKE_1H_TP1_PCT_DEFAULT = 0.95;
export const VOLUME_SPIKE_1H_TP1_POSITION_DEFAULT = 100;
export const VOLUME_SPIKE_1H_CLOSE_AFTER_HOURS_DEFAULT = 30;
export const VOLUME_SPIKE_1H_UNIVERSE_TOP_N_DEFAULT = 100;
export const VOLUME_SPIKE_1H_MIN_QUOTE_VOLUME_DEFAULT = 500_000;
/** Queda máxima BTC 1h (fracção). Abaixo disto → dump. */
export const VOLUME_SPIKE_1H_BTC_DUMP_MAX_DROP_PCT_DEFAULT = 0.015;

export type VolumeSpike1hParams = {
  universeTopN?: number;
  minQuoteVolume?: number;
  chartTimeframe?: string;
  /** Subida mínima do fecho vs fecho anterior (fracção, ex. 0.05 = 5%). */
  priceMovePct?: number;
  /** Volume ≥ este múltiplo da média das N velas anteriores. */
  volMult?: number;
  volLookback?: number;
  stopLossPct?: number;
  tp1Pct?: number;
  tp1Position?: number;
  closeAfterHours?: number;
  /** Se true, aplica filtro de dump BTC 1h. */
  btcDumpFilter?: boolean;
  /** Bloqueia entradas se BTC 1h Δ% < −este valor (fracção, ex. 0.015 = 1,5%). */
  btcDumpMaxDropPct?: number;
  /** Se true, em dump BTC fecha todas as posições abertas desta estratégia. */
  btcDumpCloseOpen?: boolean;
  autoExecuteMinStrength?: number;
  allowBuy?: boolean;
  buyEnabled?: boolean;
  allowSell?: boolean;
  sellEnabled?: boolean;
  exchange?: 'binance' | 'bybit';
};

export type VolumeSpike1hResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'done';
      timedClosed: number;
      btcDumpClosed: number;
      signalsCreated: number;
      executed: number;
      symbols: string[];
      btcDump?: boolean;
      btcPct?: number | null;
    };

export type VolumeSpike1hHit = {
  direction: 'BUY';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  strength: number;
  barCloseTs: number;
  pricePct: number;
  volRatio: number;
  extraInfo: string;
};

function parseParams(raw: string | null): VolumeSpike1hParams {
  try {
    return raw ? (JSON.parse(raw) as VolumeSpike1hParams) : {};
  } catch {
    return {};
  }
}

/** Corre no 1.º slot de 15m de cada hora (Lisboa) — vela 1h acabou de fechar. */
export function shouldRunVolumeSpike1hSchedule(now: Date = new Date()): {
  ok: boolean;
  reason?: string;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { ok: true };
  if (minute >= 15) {
    return {
      ok: false,
      reason: `volume_spike_1h só no 1.º quarto de hora (Lisboa ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`,
    };
  }
  return { ok: true };
}

/**
 * Δ% da última vela 1h fechada de BTC vs fecho anterior.
 * Exclui a vela em formação.
 */
export function btc1hChangePctFromCandles(candles: Candle[]): {
  pct: number;
  barCloseTs: number;
} | null {
  const closed = candles.slice(0, -1);
  if (closed.length < 2) return null;
  const curr = closed[closed.length - 1]!;
  const prev = closed[closed.length - 2]!;
  if (!(prev.close > 0) || !(curr.close > 0)) return null;
  return {
    pct: (curr.close - prev.close) / prev.close,
    barCloseTs: curr.timestamp,
  };
}

export async function fetchBtc1hChangePct(
  chartTimeframe = '1h'
): Promise<{ pct: number; barCloseTs: number } | null> {
  try {
    const candles = await fetchCandles(VOLUME_SPIKE_1H_BTC_SYMBOL, chartTimeframe as '1h', 6);
    return btc1hChangePctFromCandles(candles);
  } catch {
    return null;
  }
}

/** Fecha todas as posições/sinais abertos desta estratégia (dump BTC). */
async function closeAllOpenOnBtcDump(
  strategyId: string,
  exchange: 'binance' | 'bybit',
  btcPct: number,
  logPrefix: string
): Promise<number> {
  const openSignals = await prisma.signal.findMany({
    where: { strategyId, status: { in: ['NEW', 'IN_PROGRESS'] } },
    select: { id: true, symbol: true, status: true, extraInfo: true },
    orderBy: { generatedAt: 'asc' },
  });

  let closed = 0;
  const seen = new Set<string>();

  for (const sig of openSignals) {
    if (sig.status === 'IN_PROGRESS' && !seen.has(sig.symbol)) {
      seen.add(sig.symbol);
      const pos = await inspectActivePositionForSymbol(sig.symbol, exchange);
      if (pos.inspectable && pos.hasPosition) {
        const result = await closeActivePositionForSymbol(sig.symbol, exchange, {
          btcDumpClose: true,
        });
        if (result.closed) {
          closed++;
          console.log(
            `${logPrefix} 🛑 BTC dump ${(btcPct * 100).toFixed(2)}% — fechado ${sig.symbol}: ${result.message}`
          );
        } else {
          console.warn(
            `${logPrefix} ⚠️ BTC dump — falha fecho ${sig.symbol}: ${result.message}`
          );
        }
      }
    }

    let extra: Record<string, unknown> = {};
    try {
      extra = sig.extraInfo ? (JSON.parse(sig.extraInfo) as Record<string, unknown>) : {};
    } catch {
      extra = {};
    }
    await prisma.signal.update({
      where: { id: sig.id },
      data: {
        status: 'EXPIRED',
        extraInfo: JSON.stringify({
          ...extra,
          closedByBtcDump: true,
          btcDumpPct: +(btcPct * 100).toFixed(3),
          btcDumpClosedAt: new Date().toISOString(),
        }),
      },
    });
  }

  return closed;
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
 * Detecta LONG na última vela 1h fechada: +priceMovePct e vol ≥ volMult × média lookback.
 */
export function detectVolumeSpike1hBuy(
  candles: Candle[],
  params: VolumeSpike1hParams
): VolumeSpike1hHit | null {
  const priceMovePct = Math.max(
    0.001,
    Number(params.priceMovePct ?? VOLUME_SPIKE_1H_PRICE_MOVE_PCT_DEFAULT)
  );
  const volMult = Math.max(1, Number(params.volMult ?? VOLUME_SPIKE_1H_VOL_MULT_DEFAULT));
  const volLookback = Math.max(
    2,
    Math.floor(Number(params.volLookback ?? VOLUME_SPIKE_1H_VOL_LOOKBACK_DEFAULT))
  );
  const stopLossPct = Math.max(
    0.005,
    Number(params.stopLossPct ?? VOLUME_SPIKE_1H_STOP_LOSS_PCT_DEFAULT)
  );
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? VOLUME_SPIKE_1H_TP1_PCT_DEFAULT));
  const tp1Position = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.tp1Position ?? VOLUME_SPIKE_1H_TP1_POSITION_DEFAULT)))
  );
  const closeAfterHours = Math.max(
    1,
    Math.floor(Number(params.closeAfterHours ?? VOLUME_SPIKE_1H_CLOSE_AFTER_HOURS_DEFAULT))
  );
  const btcDumpMaxDropPct = Math.max(
    0.001,
    Number(params.btcDumpMaxDropPct ?? VOLUME_SPIKE_1H_BTC_DUMP_MAX_DROP_PCT_DEFAULT)
  );
  const allowBuy = !(params.allowBuy === false || params.buyEnabled === false);
  if (!allowBuy) return null;

  const closed = candles.slice(0, -1);
  if (closed.length < volLookback + 1) return null;

  const curr = closed[closed.length - 1]!;
  const prev = closed[closed.length - 2]!;
  if (!(prev.close > 0) || !(curr.close > 0) || !(curr.volume > 0)) return null;

  const pricePct = (curr.close - prev.close) / prev.close;
  if (pricePct < priceMovePct) return null;

  let sumV = 0;
  for (let j = closed.length - 1 - volLookback; j < closed.length - 1; j++) {
    sumV += closed[j]!.volume;
  }
  const avgV = sumV / volLookback;
  if (!(avgV > 0)) return null;
  const volRatio = curr.volume / avgV;
  if (volRatio < volMult) return null;

  const entryPrice = curr.close;
  const stopLoss = entryPrice * (1 - stopLossPct);
  const target1 = entryPrice * (1 + tp1Pct);
  if (!(stopLoss < entryPrice) || !(target1 > entryPrice)) return null;

  const pricePctPts = pricePct * 100;
  const strength = Math.min(
    95,
    Math.max(70, Math.round(72 + Math.min(12, pricePctPts) + Math.min(10, volRatio / 2)))
  );
  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
  const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;

  return {
    direction: 'BUY',
    entryPrice,
    stopLoss,
    target1,
    strength,
    barCloseTs: curr.timestamp,
    pricePct: +pricePctPts.toFixed(2),
    volRatio: +volRatio.toFixed(2),
    extraInfo: JSON.stringify({
      setup: 'volume_spike_1h',
      priceMovePct,
      volMult,
      volLookback,
      pricePct: +pricePctPts.toFixed(2),
      volRatio: +volRatio.toFixed(2),
      avgVolume: +avgV.toFixed(4),
      barVolume: +curr.volume.toFixed(4),
      stopLossPct,
      tp1Pct,
      tp1Position,
      closeAfterHours,
      btcDumpMaxDropPct,
      barCloseTs: curr.timestamp,
      executionProfile: `BUY | Volume Spike 1h | fecho ≥+${(priceMovePct * 100).toFixed(0)}% · vol ≥${volMult}×MA${volLookback} | SL −${slLabel} | TP +${tpLabel} (${tp1Position}% pos.) | resto às ${closeAfterHours}h | filtro BTC −${(btcDumpMaxDropPct * 100).toFixed(1)}%`,
    }),
  };
}

/**
 * Cron 15m (1.º quarto Lisboa): top N turnover → Volume Spike LONG + TP full + fecho timed.
 */
export async function runVolumeSpike1hPipeline(options?: {
  logPrefix?: string;
  force?: boolean;
}): Promise<VolumeSpike1hResult> {
  const logPrefix = options?.logPrefix ?? '[volume-spike-1h]';

  const strategy = await prisma.strategy.findUnique({
    where: { name: VOLUME_SPIKE_1H_STRATEGY_NAME },
  });
  if (!strategy) {
    return {
      status: 'skipped',
      reason: 'Estratégia VOLUME_SPIKE_1H não encontrada (correr seed/sync)',
    };
  }
  if (!strategy.isActive) {
    return { status: 'skipped', reason: 'Estratégia inactiva' };
  }

  if (!options?.force) {
    const slot = shouldRunVolumeSpike1hSchedule(new Date());
    if (!slot.ok) return { status: 'skipped', reason: slot.reason ?? 'fora do horário' };
  }

  const params = parseParams(strategy.params);
  if (params.allowBuy === false || params.buyEnabled === false) {
    return { status: 'skipped', reason: 'BUY desactivado nos params' };
  }

  const topN = Math.max(
    1,
    Math.floor(Number(params.universeTopN ?? VOLUME_SPIKE_1H_UNIVERSE_TOP_N_DEFAULT))
  );
  const minQuote = Math.max(
    0,
    Number(params.minQuoteVolume ?? VOLUME_SPIKE_1H_MIN_QUOTE_VOLUME_DEFAULT)
  );
  const chartTimeframe = String(params.chartTimeframe ?? '1h');
  const volLookback = Math.max(
    2,
    Math.floor(Number(params.volLookback ?? VOLUME_SPIKE_1H_VOL_LOOKBACK_DEFAULT))
  );
  const closeAfterHours = Math.max(
    1,
    Math.floor(Number(params.closeAfterHours ?? VOLUME_SPIKE_1H_CLOSE_AFTER_HOURS_DEFAULT))
  );
  const exchange = resolveStrategyExchange(params as Record<string, unknown>);
  const minStrength = Math.max(60, Math.floor(Number(params.autoExecuteMinStrength ?? 70)));

  let tickers;
  try {
    tickers = await fetchTopVolume24hTickers(topN + 20, minQuote);
  } catch (err) {
    console.error(`${logPrefix} Falha top volume:`, err);
    return { status: 'skipped', reason: 'Falha ao obter top volume 24h' };
  }

  const symbols = tickers
    .map((t) => t.symbol)
    .filter((s) => s.endsWith('USDT') && !s.includes('-'))
    .slice(0, topN);

  if (symbols.length === 0) {
    return { status: 'skipped', reason: 'Universo top volume vazio' };
  }

  const priceMovePct = Number(params.priceMovePct ?? VOLUME_SPIKE_1H_PRICE_MOVE_PCT_DEFAULT);
  const volMult = Number(params.volMult ?? VOLUME_SPIKE_1H_VOL_MULT_DEFAULT);
  const tp1Pct = Number(params.tp1Pct ?? VOLUME_SPIKE_1H_TP1_PCT_DEFAULT);
  const stopLossPct = Number(params.stopLossPct ?? VOLUME_SPIKE_1H_STOP_LOSS_PCT_DEFAULT);
  const btcDumpFilter = params.btcDumpFilter !== false;
  const btcDumpMaxDropPct = Math.max(
    0.001,
    Number(params.btcDumpMaxDropPct ?? VOLUME_SPIKE_1H_BTC_DUMP_MAX_DROP_PCT_DEFAULT)
  );
  const btcDumpCloseOpen = params.btcDumpCloseOpen !== false;

  const btcChange = btcDumpFilter ? await fetchBtc1hChangePct(chartTimeframe) : null;
  const btcPct = btcChange?.pct ?? null;
  const isBtcDump = btcPct != null && btcPct < -btcDumpMaxDropPct;

  console.log(
    `${logPrefix} Top ${topN} turnover (≥${minQuote}): ${symbols.length} | TF ${chartTimeframe} | +${(priceMovePct * 100).toFixed(0)}% · vol≥${volMult}×MA${volLookback} | SL −${(stopLossPct * 100).toFixed(0)}% | TP +${(tp1Pct * 100).toFixed(0)}%@100% | resto ${closeAfterHours}h | BTC ${btcPct == null ? 'n/a' : `${btcPct >= 0 ? '+' : ''}${(btcPct * 100).toFixed(2)}%`}${btcDumpFilter ? ` (dump < −${(btcDumpMaxDropPct * 100).toFixed(1)}%)` : ''}`
  );

  const startedAt = new Date();
  const timedClosed = await closeTimedOutPositions(
    strategy.id,
    closeAfterHours,
    exchange,
    logPrefix
  );

  let btcDumpClosed = 0;
  if (isBtcDump && btcDumpCloseOpen && btcPct != null) {
    console.log(
      `${logPrefix} 🛑 BTC dump ${(btcPct * 100).toFixed(2)}% < −${(btcDumpMaxDropPct * 100).toFixed(1)}% — a fechar abertos e a bloquear entradas`
    );
    btcDumpClosed = await closeAllOpenOnBtcDump(strategy.id, exchange, btcPct, logPrefix);
  }

  if (isBtcDump) {
    console.log(
      `${logPrefix} Concluído: 0 LONG (BTC dump) | timed ${timedClosed} | btcDump ${btcDumpClosed}`
    );
    return {
      status: 'done',
      timedClosed,
      btcDumpClosed,
      signalsCreated: 0,
      executed: 0,
      symbols: [],
      btcDump: true,
      btcPct,
    };
  }

  const openLongs = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      direction: 'BUY',
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    select: { symbol: true },
  });
  const openSet = new Set(openLongs.map((s) => s.symbol));

  let signalsCreated = 0;
  const hitSymbols: string[] = [];
  const warm = Math.max(30, volLookback + 5);

  for (const symbol of symbols) {
    if (openSet.has(symbol)) continue;

    let candles: Candle[];
    try {
      candles = await fetchCandles(symbol, chartTimeframe as '1h', warm);
    } catch (err) {
      console.warn(`${logPrefix} ⚠️ Candles ${symbol}:`, err);
      continue;
    }

    const hit = detectVolumeSpike1hBuy(candles, params);
    if (!hit) continue;

    const recent = await prisma.signal.findFirst({
      where: {
        strategyId: strategy.id,
        symbol,
        generatedAt: { gte: new Date(Date.now() - 36 * 3600000) },
      },
      select: { extraInfo: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (recent?.extraInfo) {
      try {
        const ex = JSON.parse(recent.extraInfo) as { barCloseTs?: number };
        if (ex.barCloseTs === hit.barCloseTs) continue;
      } catch {
        /* ignore */
      }
    }

    console.log(
      `${logPrefix} 🟢 BUY ${symbol} @ ${hit.entryPrice} (+${hit.pricePct}% · vol ${hit.volRatio}× | SL −${(stopLossPct * 100).toFixed(0)}% | TP +${(tp1Pct * 100).toFixed(0)}% | ${closeAfterHours}h)`
    );

    let extraInfo = hit.extraInfo;
    try {
      const ex = JSON.parse(hit.extraInfo) as Record<string, unknown>;
      ex.btcPctAtEntry = btcPct != null ? +(btcPct * 100).toFixed(3) : null;
      ex.btcDumpMaxDropPct = btcDumpMaxDropPct;
      extraInfo = JSON.stringify(ex);
    } catch {
      /* keep */
    }

    await prisma.signal.create({
      data: {
        symbol,
        direction: 'BUY',
        timeframe: chartTimeframe,
        strategyId: strategy.id,
        strategyName: strategy.displayName,
        entryPrice: hit.entryPrice,
        stopLoss: hit.stopLoss,
        target1: hit.target1,
        target2: null,
        target3: null,
        strength: hit.strength,
        status: 'NEW',
        extraInfo,
      },
    });

    signalsCreated++;
    hitSymbols.push(symbol);
    openSet.add(symbol);
  }

  const executed = await autoExecuteNewSignalsForStrategy({
    strategy,
    startedAt,
    minStrength,
    logPrefix,
  });

  console.log(
    `${logPrefix} Concluído: ${signalsCreated} LONG | timed ${timedClosed} | btcDump ${btcDumpClosed} | exec ${executed}`
  );

  return {
    status: 'done',
    timedClosed,
    btcDumpClosed,
    signalsCreated,
    executed,
    symbols: hitSymbols,
    btcDump: false,
    btcPct,
  };
}
