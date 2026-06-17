/**
 * Motor de geração de sinais - RSI + Volume Spike
 */

import { prisma } from './db';
import { ensureMissingBuiltinStrategies } from './ensureMissingBuiltinStrategies';
import {
  runMacdHistogramPmoStrategy,
  runRsiOverboughtDropLegacy1hStrategy,
  runRsiOverboughtDrop1hStrategy,
  runAfastamentoMedioStrategy,
  runAfastamentoMedio30mStrategy,
} from './builtinImportedStrategies';
import {
  ensureAllBuiltinUniverseScans,
  resolveUniverseScanSymbols,
  resolveUniverseScanSymbolsTopN,
  resolveUniverseScanSymbolsRankRange,
  getUniverseScanRankMap,
} from './universeScanPersistence';
import {
  UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80,
  UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
  UNIVERSE_CODE_SCANNER_3_MA80_PCT4,
  UNIVERSE_CODE_SCANNER_3_RSI75_15M,
  UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D,
} from './symbolUniverseDefaults';
import { REMOVED_DEPRECATED_STRATEGY_NAMES } from './strategyMigrations';
import { ACTIVE_SCANNER_STRATEGY_NAMES } from './strategyCatalog';
import {
  checkMaCross15mSignalGate,
  isMaCross15mHourBlocked,
  MA_CROSS_15M_MIN_TURNOVER_1H_USD,
} from './maCross15mGuard';
import {
  checkPivotBossDailySignalGate,
  isPivotBossBear15mHourBlocked,
  isPivotBossBear15mWeekendBlocked,
} from './pivotBossGuard';
import {
  fetchCandles,
  fetchTopSymbolsBy1hPriceChange,
  fetchTopSymbolsBy24hPriceChange,
  type Candle,
  type Timeframe,
} from './marketData';
import {
  calculateRSI,
  calculateRSISeries,
  calculateSMA,
  calculateSMASeries,
  calculateLastEMA,
  calculateEMA,
  calculateATR,
  getCloses,
  getVolumes,
  calculateVolumeMA,
} from './indicators';

const TOP_MOVERS_1H_FALLBACK: string[] = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'DOTUSDT',
];

export interface SignalResult {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  target3?: number;
  strength: number;
  extraInfo: string;
}

export interface StrategyParams {
  [key: string]: any;
}

/** @deprecated Importar de `maCross15mGuard` — re-export por compatibilidade. */
export { MA_CROSS_5M_SIGNAL_COOLDOWN_MS } from './maCross15mGuard';

/**
 * COMPRA/VENDA (Estratégias → `params.allowBuy` / `params.allowSell`) controla só auto-execução na corretora.
 * Só bloqueiam ordens quando são exactamente `false`; omitidos → ambos permitidos (compatível com registos antigos).
 */
export function strategyAllowsAutoExecuteDirection(
  direction: 'BUY' | 'SELL',
  params: StrategyParams | Record<string, unknown>
): boolean {
  if (direction === 'BUY') return params.allowBuy !== false;
  return params.allowSell !== false;
}

/** @deprecated Alias — preferir `strategyAllowsAutoExecuteDirection`. */
export const strategyAllowsSignalDirection = strategyAllowsAutoExecuteDirection;

export function strategyHasAnyAutoExecuteDirection(
  params: StrategyParams | Record<string, unknown>
): boolean {
  return (
    strategyAllowsAutoExecuteDirection('BUY', params) ||
    strategyAllowsAutoExecuteDirection('SELL', params)
  );
}

/** @deprecated Alias — preferir `strategyHasAnyAutoExecuteDirection`. */
export const strategyHasAnyAllowedDirection = strategyHasAnyAutoExecuteDirection;

/**
 * Estratégia Volume Spike: Gera sinais quando volume é maior que 12 vezes a média das últimas 20 horas
 * Timeframe 1h - analisa volume das últimas 20 horas
 */
export async function runVolumeSpikeStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') {
    return null;
  }

  const configuredMultiplier = Number(params.volumeMultiplier ?? 20);
  const volumeMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? Math.max(20, configuredMultiplier)
    : 20;
  const lookbackHours = params.lookbackHours || 20;

  try {
    const candlesNeeded = lookbackHours + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);

    if (candles.length < lookbackHours + 2) {
      return null;
    }

    const volumes = getVolumes(candles);
    const lastClosedIndex = volumes.length - 2;
    const currentVolume = volumes[lastClosedIndex];

    const volumesForAverage = volumes.slice(-lookbackHours - 2, -2);
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackHours);

    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    const volumeRatio = currentVolume / volumeAverage;

    if (volumeRatio < volumeMultiplier) {
      return null;
    }

    const currentPrice = candles[lastClosedIndex].close;
    const prevPrice = candles[lastClosedIndex - 1].close;
    const priceChange = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    if (direction === 'BUY') {
      const stopLoss = currentPrice * 0.87;
      const target1 = currentPrice * 1.09;
      const target2 = currentPrice * 1.25;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackHours,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    } else {
      const stopLoss = currentPrice * 1.13;
      const target1 = currentPrice * 0.91;
      const target2 = currentPrice * 0.75;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackHours,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    }
  } catch (error) {
    console.error(`Erro na estratégia Volume Spike para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia MA Cross Top Voláteis (MA60 em 1h; universo = scan MA Cross Proximidade `MaCrossBelow` na BD):
 * - BUY : fecha 2%+ ACIMA da MA60  → SL -15% | TP1 +30% (40%) | TP2 +60% (30%) | 30% fecha na reversão
 * - SELL: fecha 2%+ ABAIXO da MA60 → SL +15% | TP1 -30% (40%) | TP2 -60% (30%) | 30% fecha na reversão
 */
export async function runMa60VolatileStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const ma60Period        = params.ma60Period        ?? 60;
  const ma200Period       = params.ma200Period       ?? 200;
  const confirmationPct   = params.confirmationPct   ?? 2;
  const buyStopPercent    = params.buyStopPercent    ?? 15;
  const buyTp1Percent     = params.buyTp1Percent     ?? 30;
  const buyTp1Position    = params.buyTp1Position    ?? 40;
  const buyTp2Percent     = params.buyTp2Percent     ?? 60;
  const buyTp2Position    = params.buyTp2Position    ?? 30;
  const sellStopPercent   = params.sellStopPercent   ?? 15;
  const sellTp1Percent    = params.sellTp1Percent    ?? 30;
  const sellTp1Position   = params.sellTp1Position   ?? 40;
  const sellTp2Percent    = params.sellTp2Percent    ?? 60;
  const sellTp2Position   = params.sellTp2Position   ?? 30;

  try {
    const candlesNeeded = ma200Period + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < ma200Period + 3) return null;

    const closes = getCloses(candles);
    const closedCloses     = closes.slice(0, -1);
    const prevClosedCloses = closes.slice(0, -2);

    const ma60  = calculateSMA(closedCloses, ma60Period);
    const ma200 = calculateSMA(closedCloses, ma200Period);
    if (ma60 === null || ma200 === null) return null;

    const prevMa60 = calculateSMA(prevClosedCloses, ma60Period);
    if (prevMa60 === null) return null;

    const currentPrice = candles[candles.length - 2].close;
    const prevPrice    = candles[candles.length - 3].close;

    const confirmUp   = ma60 * (1 + confirmationPct / 100);
    const confirmDown = ma60 * (1 - confirmationPct / 100);

    // COMPRA: fecha 2%+ acima da MA60
    if (prevPrice <= prevMa60 && currentPrice > confirmUp) {
      const stopLoss = currentPrice * (1 - buyStopPercent / 100);
      const target1  = currentPrice * (1 + buyTp1Percent  / 100);
      const target2  = currentPrice * (1 + buyTp2Percent  / 100);

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma60:           ma60.toFixed(4),
          ma200:          ma200.toFixed(4),
          confirmationPct,
          crossover:      'closed candle closes 2%+ above MA60',
          stopPercent:    buyStopPercent,
          tp1Percent:     buyTp1Percent,
          tp1Position:    `${buyTp1Position}%`,
          tp2Percent:     buyTp2Percent,
          tp2Position:    `${buyTp2Position}%`,
          reversalPosition: '30%',
        }),
      };
    }

    // VENDA: fecha 2%+ abaixo da MA60
    if (prevPrice >= prevMa60 && currentPrice < confirmDown) {
      const stopLoss = currentPrice * (1 + sellStopPercent / 100);
      const target1  = currentPrice * (1 - sellTp1Percent  / 100);
      const target2  = currentPrice * (1 - sellTp2Percent  / 100);

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma60:           ma60.toFixed(4),
          ma200:          ma200.toFixed(4),
          confirmationPct,
          crossover:      'closed candle closes 2%+ below MA60',
          stopPercent:    sellStopPercent,
          tp1Percent:     sellTp1Percent,
          tp1Position:    `${sellTp1Position}%`,
          tp2Percent:     sellTp2Percent,
          tp2Position:    `${sellTp2Position}%`,
          reversalPosition: '30%',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MA Voláteis para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia MA Cross Top Voláteis (somente MA200):
 * - Analisa um universo alargado de símbolos líquidos
 * - BUY : preço fecha 2%+ ACIMA da MA200 (cruzamento confirmado)
 *         SL -4% | TP1 +80% (70%) | restante às 24h | entrada só se distância à MA200 < 10%
 * - SELL: preço fecha 2%+ ABAIXO da MA200 (cruzamento confirmado)
 *         SL +4% | TP1 -80% (70%) | restante às 24h | entrada só se distância à MA200 < 10%
 * Reversão: novo sinal oposto gerado quando preço cruza MA200 com confirmação de 2%.
 */
export async function runMa200VolatileStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '4h') return null;

  const ma200Period       = params.ma200Period       ?? 200;
  const confirmationPct   = params.confirmationPct   ?? 2;   // % além da MA200 para confirmar entrada/reversão
  const maxDistancePct    = params.maxDistancePct    ?? 10;

  // Parâmetros COMPRA
  const buyStopPercent    = params.buyStopPercent    ?? 4;
  const buyTp1Percent     = params.buyTp1Percent     ?? 80;
  const buyTp1Position    = params.buyTp1Position    ?? 70;

  // Parâmetros VENDA
  const sellStopPercent   = params.sellStopPercent   ?? 4;
  const sellTp1Percent    = params.sellTp1Percent    ?? 80;
  const sellTp1Position   = params.sellTp1Position   ?? 70;
  const closeAfterHours   = params.closeAfterHours   ?? 24;

  try {
    const candlesNeeded = ma200Period + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < ma200Period + 3) return null;

    const closes = getCloses(candles);
    // Usar apenas vela fechada para sinal (evita intrabar)
    const closedCloses     = closes.slice(0, -1);
    const prevClosedCloses = closes.slice(0, -2);

    const ma200 = calculateSMA(closedCloses, ma200Period);
    if (ma200 === null) return null;

    const prevMa200 = calculateSMA(prevClosedCloses, ma200Period);
    if (prevMa200 === null) return null;

    const currentPrice = candles[candles.length - 2].close;
    const prevPrice    = candles[candles.length - 3].close;

    // Limites de confirmação: o fecho deve estar 2%+ além da MA200
    const confirmUp   = ma200 * (1 + confirmationPct / 100);  // ex: MA200 + 2%
    const confirmDown = ma200 * (1 - confirmationPct / 100);  // ex: MA200 - 2%
    const distancePct = Math.abs((currentPrice - ma200) / ma200) * 100;

    if (distancePct >= maxDistancePct) {
      return null;
    }

    // COMPRA: vela fechada cruza MA200 para cima E fecha 2%+ acima (reversão confirmada de SELL → BUY)
    if (prevPrice <= prevMa200 && currentPrice > confirmUp) {
      const stopLoss = currentPrice * (1 - buyStopPercent / 100);
      const target1  = currentPrice * (1 + buyTp1Percent / 100);
      const distPct  = ((currentPrice - ma200) / ma200 * 100).toFixed(2);

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: undefined,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma200: ma200.toFixed(4),
          distFromMA200: `+${distPct}%`,
          crossover: `closed candle crosses +${confirmationPct}% above MA200 (reversal BUY)`,
          stopPercent: buyStopPercent,
          tp1Percent: buyTp1Percent,
          tp1Position: `${buyTp1Position}%`,
          maxDistancePct,
          executionProfile: `SL -${buyStopPercent}% | TP1 +${buyTp1Percent}% (${buyTp1Position}%) | restante às ${closeAfterHours}h | entrada só se distância < ${maxDistancePct}%`,
          timeExit: `${Math.max(0, 100 - buyTp1Position)}% às ${closeAfterHours}h`,
        }),
      };
    }

    // VENDA: vela fechada cruza MA200 para baixo E fecha 2%+ abaixo (reversão confirmada de BUY → SELL)
    if (prevPrice >= prevMa200 && currentPrice < confirmDown) {
      const stopLoss = currentPrice * (1 + sellStopPercent / 100);
      const target1  = currentPrice * (1 - sellTp1Percent / 100);
      const distPct  = ((ma200 - currentPrice) / ma200 * 100).toFixed(2);

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: undefined,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma200: ma200.toFixed(4),
          distFromMA200: `-${distPct}%`,
          crossover: `closed candle crosses -${confirmationPct}% below MA200 (reversal SELL)`,
          stopPercent: sellStopPercent,
          tp1Percent: sellTp1Percent,
          tp1Position: `${sellTp1Position}%`,
          maxDistancePct,
          executionProfile: `SL +${sellStopPercent}% | TP1 -${sellTp1Percent}% (${sellTp1Position}%) | restante às ${closeAfterHours}h | entrada só se distância < ${maxDistancePct}%`,
          timeExit: `${Math.max(0, 100 - sellTp1Position)}% às ${closeAfterHours}h`,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MA200 Voláteis para ${symbol}:`, error);
    return null;
  }
}

/**
 * RSI + SMA sobre RSI vs nível (TradingView). Velas `chartTf` (1h ou 15m).
 * @internal Usado por {@link runRsiStrategy} (1h) e {@link runRsiBybit15mStrategy} (15m).
 */
async function runRsiSma45OnTimeframe(
  symbol: string,
  chartTf: '1h' | '15m',
  params: StrategyParams
): Promise<SignalResult | null> {
  const period           = params.period ?? 14;
  const rsiSmoothLength  = Number(params.rsiSmoothLength ?? 21);
  const rsiRefLevel      = Number(params.rsiRefLevel ?? 47);
  const buyStopPercent   = Number(params.buyStopPercent ?? 5);
  const sellStopPercent  = Number(params.sellStopPercent ?? 5);
  const closeAfterHours  = params.closeAfterHours ?? 24;
  const rsiBuyGainTpPct  = Number(params.rsiBuyGainTpPct ?? 43);
  const rsiBuyGainTpPositionPct = Number(params.rsiBuyGainTpPositionPct ?? 50);
  const rsiSellGainTpPct = Number(params.rsiSellGainTpPct ?? 43);
  const rsiSellGainTpPositionPct = Number(params.rsiSellGainTpPositionPct ?? 50);

  try {
    const candlesNeeded = period + rsiSmoothLength + 50;
    const candles = await fetchCandles(symbol, chartTf, candlesNeeded);
    if (candles.length < period + rsiSmoothLength + 5) return null;

    const closes = getCloses(candles);

    // Candle fechado: exclui o em formação
    const closedCloses = closes.slice(0, -1);

    const rsiSeries = calculateRSISeries(closedCloses, period);
    if (rsiSeries.length < rsiSmoothLength + 2) return null;

    const slowSeries = calculateSMASeries(rsiSeries, rsiSmoothLength);
    if (!slowSeries || slowSeries.length < 2) return null;

    const slowNow  = slowSeries[slowSeries.length - 1];
    const slowPrev = slowSeries[slowSeries.length - 2];
    if (!Number.isFinite(slowNow) || !Number.isFinite(slowPrev)) return null;

    const rsiNow = rsiSeries[rsiSeries.length - 1];
    const currentPrice = candles[candles.length - 2].close;

    // BUY: SMA(RSI) cruza para cima o nível de referência
    if (slowPrev <= rsiRefLevel && slowNow > rsiRefLevel) {
      const target1 =
        rsiBuyGainTpPct > 0 && rsiBuyGainTpPositionPct > 0
          ? currentPrice * (1 + rsiBuyGainTpPct / 100)
          : undefined;
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice * (1 - buyStopPercent / 100),
        target1,
        target2:  undefined,
        target3:  undefined,
        strength: Math.min(100, Math.max(60, Math.round(60 + (slowNow - rsiRefLevel) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsiNow.toFixed(2),
          rsiSlow: slowNow.toFixed(2),
          rsiSlowPrev: slowPrev.toFixed(2),
          rsiRefLevel,
          rsiSmoothLength,
          period,
          rsiBuyGainTpPct,
          rsiBuyGainTpPositionPct,
          tp1Position: rsiBuyGainTpPositionPct,
          stopPercent: buyStopPercent,
          crossover: `SMA${rsiSmoothLength}(RSI${period}) cruza acima de ${rsiRefLevel} (BUY)`,
          chartTimeframe: chartTf,
          executionProfile: `SL -${buyStopPercent}% | TP1 +${rsiBuyGainTpPct}% (${rsiBuyGainTpPositionPct}% posição) | restante às ${closeAfterHours}h`,
          timeExit: `restante 100% às ${closeAfterHours}h`,
        }),
      };
    }

    // SELL: linha lenta passa para baixo do nível de referência (estava em cima ou no nível, fecha abaixo)
    if (slowPrev >= rsiRefLevel && slowNow < rsiRefLevel) {
      const target1 =
        rsiSellGainTpPct > 0 && rsiSellGainTpPositionPct > 0
          ? currentPrice * (1 - rsiSellGainTpPct / 100)
          : undefined;
      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss: currentPrice * (1 + sellStopPercent / 100),
        target1,
        target2:  undefined,
        target3:  undefined,
        strength: Math.min(100, Math.max(60, Math.round(60 + (rsiRefLevel - slowNow) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsiNow.toFixed(2),
          rsiSlow: slowNow.toFixed(2),
          rsiSlowPrev: slowPrev.toFixed(2),
          rsiRefLevel,
          rsiSmoothLength,
          period,
          rsiSellGainTpPct,
          rsiSellGainTpPositionPct,
          tp1Position: rsiSellGainTpPositionPct,
          stopPercent: sellStopPercent,
          crossover: `SMA${rsiSmoothLength}(RSI${period}) passa para baixo de ${rsiRefLevel} (SELL)`,
          chartTimeframe: chartTf,
          executionProfile: `SL +${sellStopPercent}% | TP1 -${rsiSellGainTpPct}% (${rsiSellGainTpPositionPct}% posição) | restante às ${closeAfterHours}h`,
          timeExit: `restante 100% às ${closeAfterHours}h`,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia RSI SMA/ref (${chartTf}) para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia RSI 1h — igual lógica SMA(RSI) vs nível de referência (defeito 47); universo Ma30Near6PriceBetween (ver runAllStrategies).
 */
export async function runRsiStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;
  return runRsiSma45OnTimeframe(symbol, '1h', params);
}

/**
 * RSI 15m — mesma lógica que o RSI 1h (SMA sobre RSI vs nível ref., SL/TP); velas 15m.
 * Universo de símbolos = tabela Ma30Above6Pct (MA30 > 9% vs MA200 em 1h), definido em runAllStrategies.
 */
export async function runRsiBybit15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;
  return runRsiSma45OnTimeframe(symbol, '15m', params);
}

function emaValueAtClosedIdx(emaSeries: number[], period: number, closedIdx: number): number | null {
  const off = period - 1;
  const j = closedIdx - off;
  if (j < 0 || j >= emaSeries.length) return null;
  return emaSeries[j];
}

function lowestLow(cs: Candle[], from: number, to: number): number {
  let m = Infinity;
  for (let i = Math.max(0, from); i <= to && i < cs.length; i++) {
    m = Math.min(m, cs[i].low);
  }
  return m;
}

function highestHigh(cs: Candle[], from: number, to: number): number {
  let m = -Infinity;
  for (let i = Math.max(0, from); i <= to && i < cs.length; i++) {
    m = Math.max(m, cs[i].high);
  }
  return m;
}

/**
 * EMA Ribbon Scalping (15m, Binance Futures — mesma fonte que `fetchCandles`).
 * Inspiração: fita de EMAs em tendência com inclinação forte; cenário 1 consolidação + vela SB a romper;
 * cenário 3 pullback à fita + SB de continuação. Só COMPRA na implementação actual.
 */
export async function runEmaRibbonScalpingStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;

  const ribbonFast = Math.max(2, Math.floor(Number(params.ribbonFastPeriod ?? 8)));
  const ribbonSlow = Math.max(ribbonFast + 1, Math.floor(Number(params.ribbonSlowPeriod ?? 55)));
  const atrPeriod = Math.max(2, Math.floor(Number(params.atrPeriod ?? 14)));
  const slopeLookback = Math.max(2, Math.floor(Number(params.slopeLookback ?? 5)));
  const minSlowEmaSlopePct = Number(params.minSlowEmaSlopePct ?? 0.85);
  const consolidationLookback = Math.max(5, Math.floor(Number(params.consolidationLookback ?? 14)));
  const consolidationMaxRangePct = Number(params.consolidationMaxRangePct ?? 1.35);
  const minBarsBelowFastInConsolidation = Math.max(
    1,
    Math.floor(Number(params.minBarsBelowFastInConsolidation ?? Math.ceil(consolidationLookback * 0.55)))
  );
  const pullbackMaxBars = Math.max(3, Math.floor(Number(params.pullbackMaxBars ?? 10)));
  const strongBodyOfRangeMin = Number(params.strongBodyOfRangeMin ?? 0.58);
  const strongBodyMinAtrMult = Number(params.strongBodyMinAtrMult ?? 0.42);
  const closeUpperThirdMaxFrac = Number(params.closeUpperThirdMaxFrac ?? 0.32);
  const freshBreakAtrFrac = Number(params.freshBreakAtrFrac ?? 0.07);
  const swingLookback = Math.max(2, Math.floor(Number(params.swingLookback ?? 6)));
  const swingBelowAtrMult = Number(params.swingBelowAtrMult ?? 0.14);
  const slowEmaStopBufferPct = Number(params.slowEmaStopBufferPct ?? 0.12);
  const minStopDistancePct = Number(params.minStopDistancePct ?? 0.22);
  const maxStopDistancePct = Number(params.maxStopDistancePct ?? 2.9);
  const rr1 = Number(params.rewardRisk1 ?? 1.65);
  const rr2 = Number(params.rewardRisk2 ?? 3.2);
  const tp1PositionPct = Math.min(100, Math.max(1, Math.floor(Number(params.tp1PositionPct ?? 55))));
  const tp2PositionPct = Math.min(100, Math.max(0, Math.floor(Number(params.tp2PositionPct ?? 35))));

  try {
    const warm = ribbonSlow + consolidationLookback + pullbackMaxBars + slopeLookback + atrPeriod + 30;
    const candlesNeeded = Math.min(1500, Math.max(220, warm));
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < ribbonSlow + consolidationLookback + 5) return null;

    const closedCandles = candles.slice(0, -1);
    const lc = closedCandles.length - 1;
    if (lc < ribbonSlow + consolidationLookback) return null;

    const closedCloses = closedCandles.map((c) => c.close);
    const fastSeries = calculateEMA(closedCloses, ribbonFast);
    const slowSeries = calculateEMA(closedCloses, ribbonSlow);
    if (!fastSeries || !slowSeries) return null;

    const topNow = emaValueAtClosedIdx(fastSeries, ribbonFast, lc);
    const slowNow = emaValueAtClosedIdx(slowSeries, ribbonSlow, lc);
    if (topNow == null || slowNow == null || slowNow === 0) return null;

    const slowThenIdx = lc - slopeLookback;
    const slowThen = emaValueAtClosedIdx(slowSeries, ribbonSlow, slowThenIdx);
    if (slowThen == null || slowThen === 0) return null;

    const slopePct = ((slowNow - slowThen) / slowThen) * 100;
    if (slopePct < minSlowEmaSlopePct) return null;
    if (topNow <= slowNow) return null;

    const atr = calculateATR(closedCandles, atrPeriod);
    if (atr == null || atr <= 0) return null;

    const c = closedCandles[lc];
    if (c.close <= c.open) return null;
    const body = c.close - c.open;
    const range = Math.max(c.high - c.low, 1e-12);
    if (body / range < strongBodyOfRangeMin) return null;
    if (body < atr * strongBodyMinAtrMult) return null;
    if ((c.high - c.close) / range > closeUpperThirdMaxFrac) return null;
    if (c.close <= topNow) return null;

    const prevCi = lc - 1;
    if (prevCi < ribbonFast - 1) return null;
    const prevTop = emaValueAtClosedIdx(fastSeries, ribbonFast, prevCi);
    if (prevTop == null) return null;
    if (closedCandles[prevCi].close > prevTop + atr * freshBreakAtrFrac) return null;

    let scenarioBreakout = false;
    const cStart = lc - consolidationLookback;
    const cEnd = lc - 1;
    if (cStart >= 0) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = cStart; k <= cEnd; k++) {
        hi = Math.max(hi, closedCandles[k].high);
        lo = Math.min(lo, closedCandles[k].low);
      }
      const mid = (hi + lo) / 2;
      const rangePct = mid > 0 ? ((hi - lo) / mid) * 100 : 999;
      if (rangePct <= consolidationMaxRangePct) {
        let belowFast = 0;
        let counted = 0;
        for (let k = cStart; k <= cEnd; k++) {
          const ft = emaValueAtClosedIdx(fastSeries, ribbonFast, k);
          if (ft == null) continue;
          counted++;
          if (closedCandles[k].close < ft) belowFast++;
        }
        if (counted >= consolidationLookback - 1 && belowFast >= minBarsBelowFastInConsolidation) {
          scenarioBreakout = true;
        }
      }
    }

    let scenarioPullback = false;
    const pbFrom = Math.max(ribbonSlow - 1, lc - pullbackMaxBars);
    for (let j = pbFrom; j <= lc - 2; j++) {
      const fj = emaValueAtClosedIdx(fastSeries, ribbonFast, j);
      const sj = emaValueAtClosedIdx(slowSeries, ribbonSlow, j);
      if (fj == null || sj == null) continue;
      if (!(fj > sj)) continue;
      const touch = closedCandles[j].low <= fj || closedCandles[j].close < fj;
      if (touch) {
        scenarioPullback = true;
        break;
      }
    }

    if (!scenarioBreakout && !scenarioPullback) return null;

    const scenarios: string[] = [];
    if (scenarioBreakout) scenarios.push('consolidacao_breakout_SB');
    if (scenarioPullback) scenarios.push('pullback_fita_SB');

    const swingLow = lowestLow(closedCandles, Math.max(0, lc - swingLookback), lc);
    const stopFromSwing = swingLow - atr * swingBelowAtrMult;
    const stopFromSlow = slowNow * (1 - slowEmaStopBufferPct / 100);
    let stopLoss = Math.min(stopFromSwing, stopFromSlow);

    const entryPrice = c.close;
    const minDist = entryPrice * (minStopDistancePct / 100);
    if (entryPrice - stopLoss < minDist) {
      stopLoss = entryPrice - minDist;
    }
    const maxDist = entryPrice * (maxStopDistancePct / 100);
    if (entryPrice - stopLoss > maxDist) {
      stopLoss = entryPrice - maxDist;
    }

    if (!(stopLoss < entryPrice && entryPrice - stopLoss >= minDist * 0.85)) return null;

    const risk = entryPrice - stopLoss;
    const target1 = entryPrice + risk * rr1;
    const target2 = entryPrice + risk * rr2;

    const slopeBonus = Math.min(18, Math.max(0, slopePct - minSlowEmaSlopePct) * 3);
    const bodyBonus = Math.min(14, ((body / range - strongBodyOfRangeMin) / (1 - strongBodyOfRangeMin)) * 14);
    const strength = Math.min(
      98,
      Math.max(62, Math.round(62 + slopeBonus + bodyBonus + (scenarioBreakout && scenarioPullback ? 4 : 0)))
    );

    return {
      direction: 'BUY',
      entryPrice,
      stopLoss,
      target1,
      target2,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        scenarios,
        ribbonFast,
        ribbonSlow,
        slopePct: Number(slopePct.toFixed(3)),
        minSlowEmaSlopePct,
        atr: Number(atr.toFixed(6)),
        bodyRangePct: Number(((body / range) * 100).toFixed(1)),
        executionProfile:
          `BUY apenas | SB acima da EMA rápida | SL menor entre swing −${swingBelowAtrMult.toString()}×ATR e EMA${ribbonSlow.toString()} −${slowEmaStopBufferPct}% | TP1 R×${rr1} (${tp1PositionPct}% pos.) | TP2 R×${rr2} (${tp2PositionPct}% pos.)`,
        tp1Position: tp1PositionPct,
        tp2Position: tp2PositionPct,
        rewardRisk1: rr1,
        rewardRisk2: rr2,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia EMA Ribbon Scalping (${symbol}):`, error);
    return null;
  }
}

/**
 * EMA Ribbon Scalping **venda** (15m): espelho bearish de `runEmaRibbonScalpingStrategy`.
 * Tendência com EMA lenta a cair; fita com EMA rápida abaixo da lenta; consolidação/pullback para a fita;
 * vela bear forte a fechar abaixo da EMA rápida. SL acima do swing / EMA lenta + folga. Só VENDA.
 */
export async function runEmaRibbonScalpingSellStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;

  const ribbonFast = Math.max(2, Math.floor(Number(params.ribbonFastPeriod ?? 8)));
  const ribbonSlow = Math.max(ribbonFast + 1, Math.floor(Number(params.ribbonSlowPeriod ?? 55)));
  const atrPeriod = Math.max(2, Math.floor(Number(params.atrPeriod ?? 14)));
  const slopeLookback = Math.max(2, Math.floor(Number(params.slopeLookback ?? 5)));
  const minSlowEmaSlopePct = Number(params.minSlowEmaSlopePct ?? 0.85);
  const consolidationLookback = Math.max(5, Math.floor(Number(params.consolidationLookback ?? 14)));
  const consolidationMaxRangePct = Number(params.consolidationMaxRangePct ?? 1.35);
  const minBarsAboveFastInConsolidation = Math.max(
    1,
    Math.floor(
      Number(
        params.minBarsAboveFastInConsolidation ?? Math.ceil(consolidationLookback * 0.55)
      )
    )
  );
  const pullbackMaxBars = Math.max(3, Math.floor(Number(params.pullbackMaxBars ?? 10)));
  const strongBodyOfRangeMin = Number(params.strongBodyOfRangeMin ?? 0.58);
  const strongBodyMinAtrMult = Number(params.strongBodyMinAtrMult ?? 0.42);
  const closeLowerThirdMaxFrac = Number(params.closeLowerThirdMaxFrac ?? 0.32);
  const freshBreakAtrFrac = Number(params.freshBreakAtrFrac ?? 0.07);
  const swingLookback = Math.max(2, Math.floor(Number(params.swingLookback ?? 6)));
  const swingAboveAtrMult = Number(params.swingAboveAtrMult ?? 0.14);
  const slowEmaStopBufferPct = Number(params.slowEmaStopBufferPct ?? 0.12);
  const minStopDistancePct = Number(params.minStopDistancePct ?? 0.22);
  const maxStopDistancePct = Number(params.maxStopDistancePct ?? 2.9);
  const rr1 = Number(params.rewardRisk1 ?? 1.65);
  const rr2 = Number(params.rewardRisk2 ?? 3.2);
  const tp1PositionPct = Math.min(100, Math.max(1, Math.floor(Number(params.tp1PositionPct ?? 55))));
  const tp2PositionPct = Math.min(100, Math.max(0, Math.floor(Number(params.tp2PositionPct ?? 35))));

  try {
    const warm = ribbonSlow + consolidationLookback + pullbackMaxBars + slopeLookback + atrPeriod + 30;
    const candlesNeeded = Math.min(1500, Math.max(220, warm));
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < ribbonSlow + consolidationLookback + 5) return null;

    const closedCandles = candles.slice(0, -1);
    const lc = closedCandles.length - 1;
    if (lc < ribbonSlow + consolidationLookback) return null;

    const closedCloses = closedCandles.map((c) => c.close);
    const fastSeries = calculateEMA(closedCloses, ribbonFast);
    const slowSeries = calculateEMA(closedCloses, ribbonSlow);
    if (!fastSeries || !slowSeries) return null;

    const fastNow = emaValueAtClosedIdx(fastSeries, ribbonFast, lc);
    const slowNow = emaValueAtClosedIdx(slowSeries, ribbonSlow, lc);
    if (fastNow == null || slowNow == null || slowNow === 0) return null;

    const slowThenIdx = lc - slopeLookback;
    const slowThen = emaValueAtClosedIdx(slowSeries, ribbonSlow, slowThenIdx);
    if (slowThen == null || slowThen === 0) return null;

    const slopePct = ((slowNow - slowThen) / slowThen) * 100;
    if (slopePct > -minSlowEmaSlopePct) return null;
    if (!(fastNow < slowNow)) return null;

    const atr = calculateATR(closedCandles, atrPeriod);
    if (atr == null || atr <= 0) return null;

    const c = closedCandles[lc];
    if (c.close >= c.open) return null;
    const body = c.open - c.close;
    const range = Math.max(c.high - c.low, 1e-12);
    if (body / range < strongBodyOfRangeMin) return null;
    if (body < atr * strongBodyMinAtrMult) return null;
    if ((c.close - c.low) / range > closeLowerThirdMaxFrac) return null;
    if (c.close >= fastNow) return null;

    const prevCi = lc - 1;
    if (prevCi < ribbonFast - 1) return null;
    const prevFast = emaValueAtClosedIdx(fastSeries, ribbonFast, prevCi);
    if (prevFast == null) return null;
    if (closedCandles[prevCi].close < prevFast - atr * freshBreakAtrFrac) return null;

    let scenarioBreakout = false;
    const cStart = lc - consolidationLookback;
    const cEnd = lc - 1;
    if (cStart >= 0) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = cStart; k <= cEnd; k++) {
        hi = Math.max(hi, closedCandles[k].high);
        lo = Math.min(lo, closedCandles[k].low);
      }
      const mid = (hi + lo) / 2;
      const rangePct = mid > 0 ? ((hi - lo) / mid) * 100 : 999;
      if (rangePct <= consolidationMaxRangePct) {
        let aboveFast = 0;
        let counted = 0;
        for (let k = cStart; k <= cEnd; k++) {
          const ft = emaValueAtClosedIdx(fastSeries, ribbonFast, k);
          if (ft == null) continue;
          counted++;
          if (closedCandles[k].close > ft) aboveFast++;
        }
        if (counted >= consolidationLookback - 1 && aboveFast >= minBarsAboveFastInConsolidation) {
          scenarioBreakout = true;
        }
      }
    }

    let scenarioPullback = false;
    const pbFrom = Math.max(ribbonSlow - 1, lc - pullbackMaxBars);
    for (let j = pbFrom; j <= lc - 2; j++) {
      const fj = emaValueAtClosedIdx(fastSeries, ribbonFast, j);
      const sj = emaValueAtClosedIdx(slowSeries, ribbonSlow, j);
      if (fj == null || sj == null) continue;
      if (!(fj < sj)) continue;
      const touch = closedCandles[j].high >= fj || closedCandles[j].close > fj;
      if (touch) {
        scenarioPullback = true;
        break;
      }
    }

    if (!scenarioBreakout && !scenarioPullback) return null;

    const scenarios: string[] = [];
    if (scenarioBreakout) scenarios.push('consolidacao_breakdown_SB_short');
    if (scenarioPullback) scenarios.push('pullback_fita_SB_short');

    const swingHi = highestHigh(closedCandles, Math.max(0, lc - swingLookback), lc);
    const stopFromSwing = swingHi + atr * swingAboveAtrMult;
    const stopFromSlow = slowNow * (1 + slowEmaStopBufferPct / 100);
    let stopLoss = Math.max(stopFromSwing, stopFromSlow);

    const entryPrice = c.close;
    const minDist = entryPrice * (minStopDistancePct / 100);
    if (stopLoss - entryPrice < minDist) {
      stopLoss = entryPrice + minDist;
    }
    const maxDist = entryPrice * (maxStopDistancePct / 100);
    if (stopLoss - entryPrice > maxDist) {
      stopLoss = entryPrice + maxDist;
    }

    if (!(stopLoss > entryPrice && stopLoss - entryPrice >= minDist * 0.85)) return null;

    const risk = stopLoss - entryPrice;
    const target1 = entryPrice - risk * rr1;
    const target2 = entryPrice - risk * rr2;

    const slopeStrength = Math.min(18, Math.max(0, -slopePct - minSlowEmaSlopePct) * 3);
    const bodyBonus = Math.min(14, ((body / range - strongBodyOfRangeMin) / (1 - strongBodyOfRangeMin)) * 14);
    const strength = Math.min(
      98,
      Math.max(
        62,
        Math.round(62 + slopeStrength + bodyBonus + (scenarioBreakout && scenarioPullback ? 4 : 0))
      )
    );

    return {
      direction: 'SELL',
      entryPrice,
      stopLoss,
      target1,
      target2,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        scenarios,
        ribbonFast,
        ribbonSlow,
        slopePct: Number(slopePct.toFixed(3)),
        minSlowEmaSlopePct,
        atr: Number(atr.toFixed(6)),
        bodyRangePct: Number(((body / range) * 100).toFixed(1)),
        executionProfile:
          `SELL apenas | SB abaixo da EMA rápida | SL maior entre swing +${swingAboveAtrMult.toString()}×ATR e EMA${ribbonSlow.toString()} +${slowEmaStopBufferPct}% | TP1 R×${rr1} (${tp1PositionPct}% pos.) | TP2 R×${rr2} (${tp2PositionPct}% pos.)`,
        tp1Position: tp1PositionPct,
        tp2Position: tp2PositionPct,
        rewardRisk1: rr1,
        rewardRisk2: rr2,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia EMA Ribbon Scalping SELL (${symbol}):`, error);
    return null;
  }
}

/**
 * Pivot Boss Bear — só VENDA (15m ou 1h).
 * EMA12 e EMA30 abaixo da EMA80; fecho acima SMA200 (1h) ou até −5% abaixo; pullback EMA30 + rejeição bear.
 */
async function runPivotBossBearOnTimeframe(
  symbol: string,
  timeframe: '15m' | '1h',
  params: StrategyParams
): Promise<SignalResult | null> {
  if (params.sellEnabled === false || params.allowSell === false) return null;

  const emaFast = Math.max(2, Math.floor(Number(params.emaFastPeriod ?? 12)));
  const emaMid = Math.max(emaFast + 1, Math.floor(Number(params.emaMidPeriod ?? 30)));
  const emaSlow = Math.max(emaMid + 1, Math.floor(Number(params.emaSlowPeriod ?? 80)));
  const atrPeriod = Math.max(2, Math.floor(Number(params.atrPeriod ?? 14)));
  const pullbackMaxBars = Math.max(2, Math.floor(Number(params.pullbackMaxBars ?? 2)));
  const ma200FilterPeriod = Math.max(50, Math.floor(Number(params.ma200FilterPeriod ?? 200)));
  const ma200MaxDistBelowPct = Number(params.ma200MaxDistBelowPct ?? 5);
  const strongBodyOfRangeMin = Number(params.strongBodyOfRangeMin ?? 0.55);
  const strongBodyMinAtrMult = Number(params.strongBodyMinAtrMult ?? 0.35);
  const closeLowerThirdMaxFrac = Number(params.closeLowerThirdMaxFrac ?? 0.35);
  const sellBlockMaxDistBelowEma80Pct = Number(
    params.sellBlockMaxDistBelowEma80Pct ?? 5
  );
  const swingLookback = Math.max(2, Math.floor(Number(params.swingLookback ?? 8)));
  const stopLossPct = Number(params.stopLossPct ?? 0.08);
  const tp1Pct = Number(params.tp1Pct ?? 0.09);
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));

  try {
    const historyBars = Math.max(pullbackMaxBars, swingLookback) + 5;
    const warm = emaSlow + historyBars + atrPeriod + 20;
    const candlesNeeded = Math.min(1500, Math.max(120, warm));
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < emaSlow + historyBars + 5) return null;

    const closedCandles = candles.slice(0, -1);
    const lc = closedCandles.length - 1;
    if (lc < emaSlow + historyBars) return null;

    const closedCloses = closedCandles.map((c) => c.close);
    const ema12Series = calculateEMA(closedCloses, emaFast);
    const ema30Series = calculateEMA(closedCloses, emaMid);
    const ema80Series = calculateEMA(closedCloses, emaSlow);
    if (!ema12Series || !ema30Series || !ema80Series) return null;

    const e12 = emaValueAtClosedIdx(ema12Series, emaFast, lc);
    const e30 = emaValueAtClosedIdx(ema30Series, emaMid, lc);
    const e80 = emaValueAtClosedIdx(ema80Series, emaSlow, lc);
    if (e12 == null || e30 == null || e80 == null || e80 === 0 || e30 === 0) {
      return null;
    }

    const c = closedCandles[lc];
    const entryPrice = c.close;

    let closed1h = closedCandles;
    if (timeframe !== '1h') {
      const candles1h = await fetchCandles(symbol, '1h', ma200FilterPeriod + 10);
      closed1h = candles1h.slice(0, -1);
    }
    if (closed1h.length < ma200FilterPeriod) return null;
    const closes1h = closed1h.map((bar) => bar.close);
    const sma200_1h = calculateSMA(closes1h, ma200FilterPeriod);
    const close1h = closed1h[closed1h.length - 1]?.close;
    if (sma200_1h == null || close1h == null || sma200_1h === 0) return null;
    const distBelowSma200Pct = ((sma200_1h - close1h) / sma200_1h) * 100;
    if (distBelowSma200Pct > ma200MaxDistBelowPct) return null;

    if (!(e12 < e80 && e30 < e80)) return null;
    if (!(entryPrice < e80)) return null;

    if (entryPrice < e80 && sellBlockMaxDistBelowEma80Pct > 0) {
      const distBelowEma80Pct = ((e80 - entryPrice) / e80) * 100;
      if (distBelowEma80Pct > sellBlockMaxDistBelowEma80Pct) return null;
    }

    const atr = calculateATR(closedCandles, atrPeriod);
    if (atr == null || atr <= 0) return null;

    if (c.close >= c.open) return null;
    const body = c.open - c.close;
    const range = Math.max(c.high - c.low, 1e-12);
    if (body / range < strongBodyOfRangeMin) return null;
    if (body < atr * strongBodyMinAtrMult) return null;
    if ((c.close - c.low) / range > closeLowerThirdMaxFrac) return null;
    if (c.close >= e12) return null;

    let scenarioPullback = false;
    const pbFrom = Math.max(emaSlow - 1, lc - pullbackMaxBars);
    for (let j = pbFrom; j <= lc - 1; j++) {
      const j30 = emaValueAtClosedIdx(ema30Series, emaMid, j);
      if (j30 == null) continue;
      const bar = closedCandles[j];
      const touch30 = bar.high >= j30 * (1 - 0.002);
      if (touch30) {
        scenarioPullback = true;
        break;
      }
    }

    if (!scenarioPullback) return null;

    const scenarios: string[] = ['pullback_rejeicao_ema30'];

    const stopLoss = entryPrice * (1 + stopLossPct);
    if (!(stopLoss > entryPrice)) return null;

    const target1 = entryPrice * (1 - tp1Pct);

    const bodyBonus = Math.min(
      18,
      ((body / range - strongBodyOfRangeMin) / (1 - strongBodyOfRangeMin)) * 18
    );
    const strength = Math.min(98, Math.max(62, Math.round(62 + bodyBonus)));

    const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
    const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;

    return {
      direction: 'SELL',
      entryPrice,
      stopLoss,
      target1,
      target2: undefined,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        scenarios,
        emaStack: { ema12: e12, ema30: e30, ema80: e80 },
        sma200_1h: sma200_1h,
        close1h,
        distBelowSma200Pct: Number(distBelowSma200Pct.toFixed(3)),
        ma200MaxDistBelowPct,
        stopLossPct,
        tp1Pct,
        tp1Position,
        closeAfterHours,
        bodyRangePct: Number(((body / range) * 100).toFixed(1)),
        executionProfile:
          `SELL apenas | Pivot Boss bear ${timeframe} (EMA12/30 abaixo EMA80, SMA200 1h acima ou ≤−${ma200MaxDistBelowPct}%) | SL +${slLabel} fixo | TP1 -${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia Pivot Boss Bear ${timeframe} (${symbol}):`, error);
    return null;
  }
}

export async function runPivotBossBear15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;
  return runPivotBossBearOnTimeframe(symbol, '15m', params);
}

export async function runPivotBossBear1hStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;
  return runPivotBossBearOnTimeframe(symbol, '1h', params);
}

/**
 * Rompimento de acumulação (15m) — só COMPRA.
 * Sinal quando o fecho da última vela fechada rompe ACIMA do máximo das últimas N velas
 * (range de acumulação). SL = mínimo da acumulação; TP1 = risco × rewardRisk1.
 */
export async function runAccumulationBreakout15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;
  if (params.buyEnabled === false || params.allowBuy === false) return null;

  const lookback = Math.max(2, Math.floor(Number(params.breakoutLookback ?? 10)));
  const requireBullishClose = params.requireBullishClose !== false;
  const volumeMultiplier = Math.max(0, Number(params.volumeMultiplier ?? 1));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.07));
  const rewardRisk1 = Math.max(0.2, Number(params.rewardRisk1 ?? 1.5));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));

  try {
    const candlesNeeded = Math.min(500, Math.max(lookback + 5, 60));
    const candles = await fetchCandles(symbol, '15m', candlesNeeded);
    if (candles.length < lookback + 2) return null;

    // Última vela ainda em formação removida; analisamos a última FECHADA.
    const closedCandles = candles.slice(0, -1);
    if (closedCandles.length < lookback + 1) return null;

    const breakoutCandle = closedCandles[closedCandles.length - 1];
    // As N velas de acumulação anteriores à vela de rompimento.
    const rangeCandles = closedCandles.slice(
      closedCandles.length - 1 - lookback,
      closedCandles.length - 1
    );
    if (rangeCandles.length < lookback) return null;

    const rangeHigh = Math.max(...rangeCandles.map((c) => c.high));
    const rangeLow = Math.min(...rangeCandles.map((c) => c.low));
    if (!(rangeHigh > 0) || !(rangeLow > 0)) return null;

    // Rompimento confirmado: fecho acima do máximo das últimas N velas.
    if (!(breakoutCandle.close > rangeHigh)) return null;
    if (requireBullishClose && !(breakoutCandle.close > breakoutCandle.open)) return null;

    // Confirmação de volume (opcional).
    if (volumeMultiplier > 0) {
      const avgVol =
        rangeCandles.reduce((sum, c) => sum + (c.volume || 0), 0) / rangeCandles.length;
      if (avgVol > 0 && breakoutCandle.volume < avgVol * volumeMultiplier) return null;
    }

    const entryPrice = breakoutCandle.close;
    const stopLoss = entryPrice * (1 - stopLossPct);
    if (!(stopLoss < entryPrice)) return null;

    const risk = entryPrice - stopLoss;
    const target1 = entryPrice + risk * rewardRisk1;

    const breakoutMarginPct = ((entryPrice - rangeHigh) / rangeHigh) * 100;
    const maxStrength = Math.max(60, Math.floor(Number(params.maxStrength ?? 75)));
    const rawStrength = Math.max(60, Math.round(60 + Math.min(25, breakoutMarginPct * 8)));
    if (rawStrength > maxStrength) return null;
    const strength = rawStrength;

    return {
      direction: 'BUY',
      entryPrice,
      stopLoss,
      target1,
      target2: undefined,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        setup: 'accumulation_breakout',
        breakoutLookback: lookback,
        rangeHigh,
        rangeLow,
        breakoutMarginPct: Number(breakoutMarginPct.toFixed(3)),
        maxStrength,
        stopLossPct,
        rewardRisk1,
        tp1Position,
        closeAfterHours,
        executionProfile: `BUY | Rompimento acumulação 15m (fecho > máx. ${lookback} velas) | SL -${(stopLossPct * 100).toFixed(0)}% fixo | TP1 R×${rewardRisk1} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia Rompimento Acumulação 15m (${symbol}):`, error);
    return null;
  }
}

/**
 * Scanner 3 — RSI entre min/max + rompimento de acumulação 15m (só COMPRA).
 */
export async function runScanner3RsiBreakout15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;
  if (params.buyEnabled === false || params.allowBuy === false) return null;

  const rsiPeriod = Math.max(2, Math.floor(Number(params.rsiPeriod ?? 14)));
  const minRsi = Number(params.minRsi ?? 72);
  const maxRsi = Number(params.maxRsi ?? 85);
  const lookback = Math.max(2, Math.floor(Number(params.breakoutLookback ?? 10)));
  const requireBullishClose = params.requireBullishClose !== false;
  const volumeMultiplier = Math.max(0, Number(params.volumeMultiplier ?? 1));
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.07));
  const rewardRisk1 = Math.max(0.2, Number(params.rewardRisk1 ?? 1.5));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));

  if (!(minRsi < maxRsi)) return null;

  try {
    const candlesNeeded = Math.min(500, Math.max(lookback + rsiPeriod + 20, 60));
    const candles = await fetchCandles(symbol, '15m', candlesNeeded);
    if (candles.length < lookback + rsiPeriod + 2) return null;

    const closedCandles = candles.slice(0, -1);
    if (closedCandles.length < lookback + rsiPeriod + 1) return null;

    const breakoutCandle = closedCandles[closedCandles.length - 1];
    const rangeCandles = closedCandles.slice(
      closedCandles.length - 1 - lookback,
      closedCandles.length - 1
    );
    if (rangeCandles.length < lookback) return null;

    const closedCloses = closedCandles.map((c) => c.close);
    const rsi = calculateRSI(closedCloses, rsiPeriod);
    if (rsi == null || rsi <= minRsi || rsi >= maxRsi) return null;

    const rangeHigh = Math.max(...rangeCandles.map((c) => c.high));
    const rangeLow = Math.min(...rangeCandles.map((c) => c.low));
    if (!(rangeHigh > 0) || !(rangeLow > 0)) return null;

    if (!(breakoutCandle.close > rangeHigh)) return null;
    if (requireBullishClose && !(breakoutCandle.close > breakoutCandle.open)) return null;

    if (volumeMultiplier > 0) {
      const avgVol =
        rangeCandles.reduce((sum, c) => sum + (c.volume || 0), 0) / rangeCandles.length;
      if (avgVol > 0 && breakoutCandle.volume < avgVol * volumeMultiplier) return null;
    }

    const entryPrice = breakoutCandle.close;
    const stopLoss = entryPrice * (1 - stopLossPct);
    if (!(stopLoss < entryPrice)) return null;

    const risk = entryPrice - stopLoss;
    const target1 = entryPrice + risk * rewardRisk1;

    const breakoutMarginPct = ((entryPrice - rangeHigh) / rangeHigh) * 100;
    const strength = Math.min(
      95,
      Math.max(60, Math.round(60 + Math.min(20, breakoutMarginPct * 6) + Math.min(10, (rsi - minRsi) / 2)))
    );

    return {
      direction: 'BUY',
      entryPrice,
      stopLoss,
      target1,
      target2: undefined,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        setup: 'scanner3_rsi_breakout',
        rsiPeriod,
        rsi: Number(rsi.toFixed(2)),
        minRsi,
        maxRsi,
        breakoutLookback: lookback,
        rangeHigh,
        rangeLow,
        breakoutMarginPct: Number(breakoutMarginPct.toFixed(3)),
        stopLossPct,
        rewardRisk1,
        tp1Position,
        closeAfterHours,
        executionProfile: `BUY | Scanner 3 RSI ${minRsi}–${maxRsi} + rompimento 15m (fecho > máx. ${lookback} velas) | SL -${(stopLossPct * 100).toFixed(0)}% | TP1 R×${rewardRisk1} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia Scanner 3 RSI Rompimento 15m (${symbol}):`, error);
    return null;
  }
}

/**
 * VENDA 15m: preço abaixo da EMA80 com SMA(7) ainda acima da EMA80 (quebra com média curta elevada).
 */
export async function runEma80Sma7Breakdown15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;
  if (params.sellEnabled === false || params.allowSell === false) return null;

  const emaPeriod = Math.max(2, Math.floor(Number(params.emaPeriod ?? 80)));
  const smaPeriod = Math.max(2, Math.floor(Number(params.smaPeriod ?? 7)));
  const requireCrossDown = params.requireCrossDown !== false;
  const stopLossPct = Math.max(0.005, Number(params.stopLossPct ?? 0.08));
  const tp1Pct = Math.max(0.01, Number(params.tp1Pct ?? 0.2));
  const tp1Position = Math.min(100, Math.max(1, Math.floor(Number(params.tp1Position ?? 50))));
  const closeAfterHours = Math.max(1, Math.floor(Number(params.closeAfterHours ?? 24)));

  try {
    const candlesNeeded = Math.min(500, Math.max(emaPeriod + smaPeriod + 20, 100));
    const candles = await fetchCandles(symbol, '15m', candlesNeeded);
    if (candles.length < emaPeriod + 3) return null;

    const closedCandles = candles.slice(0, -1);
    const lc = closedCandles.length - 1;
    if (lc < emaPeriod) return null;

    const closes = closedCandles.map((c) => c.close);
    const emaSeries = calculateEMA(closes, emaPeriod);
    if (!emaSeries) return null;

    const e80 = emaValueAtClosedIdx(emaSeries, emaPeriod, lc);
    const sma7 = calculateSMA(closes, smaPeriod);
    if (e80 == null || sma7 == null || !(e80 > 0)) return null;

    const entryPrice = closedCandles[lc].close;
    if (!(entryPrice < e80)) return null;
    if (!(sma7 > e80)) return null;

    if (requireCrossDown && lc >= 1) {
      const prevCloses = closes.slice(0, lc);
      const prevEmaSeries = calculateEMA(prevCloses, emaPeriod);
      const prevE80 =
        prevEmaSeries != null ? emaValueAtClosedIdx(prevEmaSeries, emaPeriod, lc - 1) : null;
      const prevClose = closedCandles[lc - 1].close;
      if (prevE80 == null || !(prevClose >= prevE80)) return null;
    }

    const stopLoss = entryPrice * (1 + stopLossPct);
    if (!(stopLoss > entryPrice)) return null;
    const target1 = entryPrice * (1 - tp1Pct);

    const distBelowEma80Pct = ((e80 - entryPrice) / e80) * 100;
    const sma7PremiumPct = ((sma7 - e80) / e80) * 100;
    const strength = Math.min(
      92,
      Math.max(62, Math.round(65 + Math.min(12, distBelowEma80Pct * 3) + Math.min(10, sma7PremiumPct * 2)))
    );

    const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
    const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;

    return {
      direction: 'SELL',
      entryPrice,
      stopLoss,
      target1,
      target2: undefined,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        setup: 'ema80_sma7_breakdown',
        emaPeriod,
        smaPeriod,
        ema80: Number(e80.toFixed(6)),
        sma7: Number(sma7.toFixed(6)),
        distBelowEma80Pct: Number(distBelowEma80Pct.toFixed(3)),
        sma7PremiumPct: Number(sma7PremiumPct.toFixed(3)),
        requireCrossDown,
        stopLossPct,
        tp1Pct,
        tp1Position,
        closeAfterHours,
        executionProfile: `SELL | Quebra EMA${emaPeriod} (SMA${smaPeriod}>EMA${emaPeriod}) | SL +${slLabel} | TP1 -${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia Quebra EMA80 SMA7 15m (${symbol}):`, error);
    return null;
  }
}

/**
 * Estratégia RSI 15m — Reversal oversold:
 * BUY quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32
 * Apenas BUY | SL -3% | TP1 +5% | TP2 +14%
 * Usa sempre o candle fechado (não o em formação).
 * Sem filtro MA200 para sinal mais rápido.
 * Corre no universo da BD Ma30Near6PriceBetween (scan MA30 −6%…+1% vs MA200 em 1h).
 */
export async function runRsi15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') return null;

  const period = params.period ?? 14;
  const previousBelowThreshold = params.previousBelowThreshold ?? 28;
  const buyThreshold = params.buyThreshold ?? 32;
  const stopPercent = params.stopPercent ?? 3;

  try {
    const candlesNeeded = period + 30;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < period + 3) return null;

    const closes = getCloses(candles);

    // Usa candle fechado: exclui o candle ainda em formação
    const closedCloses     = closes.slice(0, -1);
    const prevClosedCloses = closes.slice(0, -2);

    const rsi     = calculateRSI(closedCloses,     period);
    const prevRsi = calculateRSI(prevClosedCloses,  period);
    if (rsi === null || prevRsi === null) return null;

    const currentPrice = candles[candles.length - 2].close; // último candle fechado

    // BUY: RSI anterior abaixo de 28 e RSI actual fecha acima de 32
    if (prevRsi < previousBelowThreshold && rsi > buyThreshold) {
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice * (1 - stopPercent / 100),
        target1:  currentPrice * 1.05,   // TP1 +5%  — 35% posição
        target2:  currentPrice * 1.14,   // TP2 +14% — 30% posição (35% fecha às 24h)
        target3:  undefined,
        strength: Math.min(100, Math.max(60, Math.round(60 + (rsi - buyThreshold) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsi.toFixed(2),
          prevRsi: prevRsi.toFixed(2),
          previousBelowThreshold,
          buyThreshold,
          stopPercent,
          executionProfile: `BUY only | RSI prev < ${previousBelowThreshold} and current > ${buyThreshold} | SL -${stopPercent}%`,
          tp1Percent: 5, tp1Position: 35,
          tp2Percent: 14, tp2Position: 30,
          tp3: '35% às 24h',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia RSI 15m para ${symbol}:`, error);
    return null;
  }
}

/**
 * MA rápida × MA lenta em velas fechadas (`ma200Period` = período da média lenta; `maType` EMA ou SMA).
 * Em **15m** e **1h** usa **modo spread** (`|rápida−lenta|/lenta`, limiares entrada/saída, repetir tendência, TP parcial + compressão) — mesma filosofia MA12×MA30 e MA30×MA200.
 */
async function runMaCrossM30M200OnTimeframe(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams,
  bar: '5m' | '15m' | '1h'
): Promise<SignalResult | null> {
  if (timeframe !== bar) return null;

  const ma30Period = params.ma30Period ?? (bar === '5m' ? 12 : 30);
  const maSlowPeriod = Number(
    params.ma200Period ?? (bar === '5m' ? 30 : 200)
  );
  // Modo MA12xMA30: spread |MA rápida − MA lenta|/MA lenta. 15m/1h: sempre neste função (evita BD com períodos ≠12/30 cair no modo cruzamento MA30/MA200).
  const isMa12x30Mode = Boolean(
    params.useDiffMode === true ||
      (timeframe === '15m' && bar === '15m') ||
      (timeframe === '1h' && bar === '1h') ||
      (timeframe === '15m' && ma30Period === 12 && maSlowPeriod === 30)
  );
  const maType: 'SMA' | 'EMA' = params.maType === 'SMA' ? 'SMA' : 'EMA';
  const confirmationPct = params.confirmationPct ?? 0;
  const entryDiffPct = Number(params.entryDiffPct ?? 0.9);
  /** Tecto do spread |MA rápida − MA lenta|/MA lenta na entrada (ex. 1,8). 0 = sem máximo. */
  const entryMaxDiffPct = Number(
    params.entryMaxDiffPct ?? (bar === '15m' ? 1.8 : 0)
  );
  const exitDiffPct = Number(params.exitDiffPct ?? 0.5);
  const stopPercent     = params.stopPercent     ?? 8;
  const buyTp1Percent   = params.buyTp1Percent   ?? params.tp1Percent ?? (bar === '5m' ? 18 : 85);
  const buyTp1Position  = params.buyTp1Position  ?? params.tp1Position ?? (bar === '5m' ? 30 : 60);
  const buyTp2Percent   = params.buyTp2Percent   ?? params.tp2Percent ?? (bar === '5m' ? 40 : 0);
  const buyTp2Position  = params.buyTp2Position  ?? params.tp2Position ?? (bar === '5m' ? 30 : 0);
  const sellTp1Percent  = params.sellTp1Percent  ?? params.tp1Percent ?? (bar === '5m' ? 7 : 85);
  const sellTp1Position = params.sellTp1Position ?? params.tp1Position ?? (bar === '5m' ? 30 : 60);
  const sellTp2Percent  = params.sellTp2Percent  ?? params.tp2Percent ?? (bar === '5m' ? 15 : 0);
  const sellTp2Position = params.sellTp2Position ?? params.tp2Position ?? (bar === '5m' ? 30 : 0);
  const slowLabel = `MA${maSlowPeriod}`;
  const fastLabel = `MA${ma30Period}`;
  /**
   * SELL: não emitir se |close−MA lenta|/MA lenta*100 (%) for > N%. 0 = desactiva. Default 6.
   * (o param chama-se sellBlockAbsCloseDistanceFromMa200Pct no JSON)
   */
  const sellBlockAbsCloseDistanceFromMa200Pct = Number(
    params.sellBlockAbsCloseDistanceFromMa200Pct ?? 6
  );
  /**
   * BUY (modo spread): não emitir se |close−MA lenta|/MA lenta*100 (%) for > N%. 0 = desactiva.
   */
  const buyBlockAbsCloseDistanceFromMa200Pct = Number(
    params.buyBlockAbsCloseDistanceFromMa200Pct ?? 0
  );

  /**
   * MA12×MA30: se true, permite re-entrada sem exigir que o spread da vela anterior fosse ≤ `entryDiffPct`,
   * mas **não** dispara em todas as velas: exige sempre uma «novidade» (ver `ma12x30RepeatEligibleBuy` no código).
   * Se false, exige também transição na vela anterior (spread antes ≤ limiar ou alinhamento diferente).
   */
  const repeatSpreadWhileTrend = params.ma12x30RepeatWhileTrend === true;
  /** No modo repeat: spread actual deve superar o da vela anterior pelo menos estes pontos percentuais (na mesma métrica que entryDiffPct). */
  const minRepeatSpreadDelta = Number(params.ma12x30RepeatMinSpreadDeltaPct ?? 0.06);

  /** TP parcial quando preço favorável ≥ este % vs entrada (compra: +N%; venda: −N%). */
  const ma12x30GainTpPct = Number(params.ma12x30GainTpPct ?? 44);
  /** % da posição a fechar nesse TP parcial. */
  const ma12x30GainTpPositionPct = Number(params.ma12x30GainTpPositionPct ?? 60);

  /**
   * Entrada só se |MA lenta − MA200|/MA200×100 ≤ N (MA200 = período fixo 200 no mesmo timeframe).
   * 0 = desactiva. Só aplicável quando MA lenta ≠ MA200 (ex. MA12/MA30 com lenta período 30).
   */
  const entryMaxAbsPctMa30VsMa200 = Number(params.entryMaxAbsPctMa30VsMa200 ?? 0);
  /** |MA80 − MA200|/MA200×100 ≤ N nas velas do sinal (15m). 0 = desactiva. */
  const ma80Period = Math.max(2, Math.floor(Number(params.ma80Period ?? 80)));
  const entryMaxAbsPctMa80VsMa200 = Number(
    params.entryMaxAbsPctMa80VsMa200 ?? (bar === '15m' ? 3 : 0)
  );
  const ma200LongPeriod = 200;

  const ma = (arr: number[], p: number) =>
    maType === 'SMA' ? calculateSMA(arr, p) : calculateLastEMA(arr, p);

  try {
    const emaCandles = Math.min(1000, Math.max(600, maSlowPeriod * 3));
    const requested =
      params.emaCandleLookback != null && Number.isFinite(Number(params.emaCandleLookback))
        ? Math.min(1500, Math.max(200, Math.floor(Number(params.emaCandleLookback))))
        : null;
    let candlesNeeded =
      maType === 'SMA'
        ? maSlowPeriod + 5
        : (requested ?? emaCandles);
    if (
      isMa12x30Mode &&
      (entryMaxAbsPctMa30VsMa200 > 0 ||
        entryMaxAbsPctMa80VsMa200 > 0) &&
      maSlowPeriod < ma200LongPeriod
    ) {
      candlesNeeded = Math.max(
        candlesNeeded,
        ma200LongPeriod + 5,
        entryMaxAbsPctMa80VsMa200 > 0 ? ma80Period + 5 : 0
      );
    }
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < maSlowPeriod + 3) return null;

    const closes = getCloses(candles);
    const closedCloses     = closes.slice(0, -1);
    const prevClosedCloses = closes.slice(0, -2);

    const ma30  = ma(closedCloses, ma30Period);
    const maSlow = ma(closedCloses, maSlowPeriod);
    if (ma30 === null || maSlow === null) return null;

    const prevMa30  = ma(prevClosedCloses, ma30Period);
    const prevMaSlow = ma(prevClosedCloses, maSlowPeriod);
    if (prevMa30 === null || prevMaSlow === null) return null;

    let absPctMaSlowVsMa200: number | undefined;
    let absPctMa80VsMa200: number | undefined;
    const needsMa200Long =
      isMa12x30Mode &&
      (entryMaxAbsPctMa30VsMa200 > 0 || entryMaxAbsPctMa80VsMa200 > 0);
    if (needsMa200Long) {
      const ma200Long = ma(closedCloses, ma200LongPeriod);
      if (
        ma200Long === null ||
        !Number.isFinite(ma200Long) ||
        Math.abs(ma200Long) < 1e-12
      ) {
        return null;
      }

      if (entryMaxAbsPctMa30VsMa200 > 0 && maSlowPeriod < ma200LongPeriod) {
        absPctMaSlowVsMa200 = Math.abs((maSlow - ma200Long) / ma200Long) * 100;
        if (absPctMaSlowVsMa200 > entryMaxAbsPctMa30VsMa200) {
          return null;
        }
      }

      if (entryMaxAbsPctMa80VsMa200 > 0) {
        const ma80 = ma(closedCloses, ma80Period);
        if (ma80 === null || !Number.isFinite(ma80)) {
          return null;
        }
        absPctMa80VsMa200 = Math.abs((ma80 - ma200Long) / ma200Long) * 100;
        if (absPctMa80VsMa200 > entryMaxAbsPctMa80VsMa200) {
          return null;
        }
      }
    }

    const currentPrice = candles[candles.length - 2].close;
    const distCloseSlowAbsPct = Math.abs((currentPrice - maSlow) / maSlow) * 100;
    const currentDiffPct = Math.abs((ma30 - maSlow) / maSlow) * 100;
    const prevDiffPct = Math.abs((prevMa30 - prevMaSlow) / prevMaSlow) * 100;
    const bullishNow = ma30 > maSlow;
    const bearishNow = ma30 < maSlow;
    const bullishPrev = prevMa30 > prevMaSlow;
    const bearishPrev = prevMa30 < prevMaSlow;

    const ma12x30RepeatEligibleBuy =
      prevDiffPct <= entryDiffPct ||
      !bullishPrev ||
      currentDiffPct > prevDiffPct + minRepeatSpreadDelta;

    const ma12x30RepeatEligibleSell =
      prevDiffPct <= entryDiffPct ||
      !bearishPrev ||
      currentDiffPct > prevDiffPct + minRepeatSpreadDelta;

    const confirmUp   = maSlow * (1 + confirmationPct / 100);
    const confirmDown = maSlow * (1 - confirmationPct / 100);

    const spreadInEntryBand =
      currentDiffPct > entryDiffPct &&
      (entryMaxDiffPct <= 0 || currentDiffPct < entryMaxDiffPct);

    const ma12x30BuyOk =
      bullishNow &&
      spreadInEntryBand &&
      (repeatSpreadWhileTrend
        ? ma12x30RepeatEligibleBuy
        : !bullishPrev || prevDiffPct <= entryDiffPct);

    if (
      isMa12x30Mode
        ? ma12x30BuyOk &&
            (buyBlockAbsCloseDistanceFromMa200Pct <= 0 ||
              distCloseSlowAbsPct <= buyBlockAbsCloseDistanceFromMa200Pct)
        : (prevMa30 <= prevMaSlow && ma30 > confirmUp)
    ) {
      const stopLoss = currentPrice * (1 - stopPercent / 100);
      const target1 = isMa12x30Mode
        ? currentPrice * (1 + ma12x30GainTpPct / 100)
        : currentPrice * (1 + buyTp1Percent / 100);
      const target2 = isMa12x30Mode
        ? undefined
        : buyTp2Percent > 0
          ? currentPrice * (1 + buyTp2Percent / 100)
          : undefined;

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          timeframe: bar,
          maType,
          ma30: ma30.toFixed(4),
          maSlow: maSlow.toFixed(4),
          maSlowPeriod,
          ma200: maSlow.toFixed(4),
          diffPct: currentDiffPct.toFixed(3),
          distCloseMaSlowAbsPct: distCloseSlowAbsPct.toFixed(2),
          entryDiffPct,
          entryMaxDiffPct: entryMaxDiffPct > 0 ? entryMaxDiffPct : 'off',
          exitDiffPct,
          confirmationPct,
          crossover: isMa12x30Mode
            ? entryMaxDiffPct > 0
              ? `${fastLabel}/${slowLabel} bullish spread ${entryDiffPct}–${entryMaxDiffPct}% (BUY)`
              : `${fastLabel}/${slowLabel} bullish spread > ${entryDiffPct}% (BUY)`
            : `${fastLabel} crosses +${confirmationPct}% above ${slowLabel} (BUY)`,
          stopPercent,
          ...(isMa12x30Mode
            ? {
                ma12x30GainTpPct,
                ma12x30GainTpPositionPct,
                tp1Position: ma12x30GainTpPositionPct,
                buyBlockAbsCloseDistanceFromMa200Pct:
                  buyBlockAbsCloseDistanceFromMa200Pct || 'off',
                ...(absPctMaSlowVsMa200 !== undefined
                  ? {
                      entryMaxAbsPctMa30VsMa200,
                      absPctMaSlowVsMa200: absPctMaSlowVsMa200.toFixed(2),
                    }
                  : {}),
                ...(absPctMa80VsMa200 !== undefined
                  ? {
                      entryMaxAbsPctMa80VsMa200,
                      ma80Period,
                      absPctMa80VsMa200: absPctMa80VsMa200.toFixed(2),
                    }
                  : {}),
                executionProfile: `SL -${stopPercent}% | TP1 +${ma12x30GainTpPct}% (${ma12x30GainTpPositionPct}% posição) | restante: fecho dinâmico se spread < ${exitDiffPct}%`,
              }
            : {
                tp1Percent: buyTp1Percent,
                tp1Position: `${buyTp1Position}%`,
                tp2Percent: buyTp2Percent,
                tp2Position: `${buyTp2Position}%`,
                executionProfile: `SL -${stopPercent}% | TP1 +${buyTp1Percent}% (${buyTp1Position}% posição) | TP2 +${buyTp2Percent}% (${buyTp2Position}% posição) | restante aberto`,
              }),
        }),
      };
    }

    const ma12x30SellOk =
      bearishNow &&
      spreadInEntryBand &&
      (repeatSpreadWhileTrend
        ? ma12x30RepeatEligibleSell
        : !bearishPrev || prevDiffPct <= entryDiffPct);

    if (
      isMa12x30Mode
        ? ma12x30SellOk
        : (prevMa30 >= prevMaSlow && ma30 < confirmDown)
    ) {
      if (
        sellBlockAbsCloseDistanceFromMa200Pct > 0 &&
        distCloseSlowAbsPct > sellBlockAbsCloseDistanceFromMa200Pct
      ) {
        return null;
      }

      const stopLoss = currentPrice * (1 + stopPercent / 100);
      const target1 = isMa12x30Mode
        ? currentPrice * (1 - ma12x30GainTpPct / 100)
        : currentPrice * (1 - sellTp1Percent / 100);
      const target2 = isMa12x30Mode
        ? undefined
        : sellTp2Percent > 0
          ? currentPrice * (1 - sellTp2Percent / 100)
          : undefined;

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          timeframe: bar,
          maType,
          ma30: ma30.toFixed(4),
          maSlow: maSlow.toFixed(4),
          maSlowPeriod,
          ma200: maSlow.toFixed(4),
          diffPct: currentDiffPct.toFixed(3),
          entryDiffPct,
          entryMaxDiffPct: entryMaxDiffPct > 0 ? entryMaxDiffPct : 'off',
          exitDiffPct,
          distCloseMa200AbsPct: distCloseSlowAbsPct.toFixed(2),
          sellBlockAbsCloseDistanceFromMa200Pct:
            sellBlockAbsCloseDistanceFromMa200Pct || 'off',
          confirmationPct,
          crossover: isMa12x30Mode
            ? entryMaxDiffPct > 0
              ? `${fastLabel}/${slowLabel} bearish spread ${entryDiffPct}–${entryMaxDiffPct}% (SELL)`
              : `${fastLabel}/${slowLabel} bearish spread > ${entryDiffPct}% (SELL)`
            : `${fastLabel} crosses -${confirmationPct}% below ${slowLabel} (SELL)`,
          stopPercent,
          ...(isMa12x30Mode
            ? {
                ma12x30GainTpPct,
                ma12x30GainTpPositionPct,
                tp1Position: ma12x30GainTpPositionPct,
                ...(absPctMaSlowVsMa200 !== undefined
                  ? {
                      entryMaxAbsPctMa30VsMa200,
                      absPctMaSlowVsMa200: absPctMaSlowVsMa200.toFixed(2),
                    }
                  : {}),
                ...(absPctMa80VsMa200 !== undefined
                  ? {
                      entryMaxAbsPctMa80VsMa200,
                      ma80Period,
                      absPctMa80VsMa200: absPctMa80VsMa200.toFixed(2),
                    }
                  : {}),
                executionProfile: `SL +${stopPercent}% | TP1 -${ma12x30GainTpPct}% (${ma12x30GainTpPositionPct}% posição) | restante: fecho dinâmico se spread < ${exitDiffPct}%`,
              }
            : {
                tp1Percent: sellTp1Percent,
                tp1Position: `${sellTp1Position}%`,
                tp2Percent: sellTp2Percent,
                tp2Position: `${sellTp2Position}%`,
                executionProfile: `SL +${stopPercent}% | TP1 -${sellTp1Percent}% (${sellTp1Position}% posição) | TP2 -${sellTp2Percent}% (${sellTp2Position}% posição) | restante aberto`,
              }),
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MA Cross ${bar} para ${symbol}:`, error);
    return null;
  }
}

/** MA12 / MA30 em 15m (modo spread por diferença entre médias). */
export async function runMaCross15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  return runMaCrossM30M200OnTimeframe(symbol, timeframe, params, '15m');
}

/** MA12 / MA30 por defeito em velas 5m — cron 15m no endpoint dedicado. */
export async function runMaCross5mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  return runMaCrossM30M200OnTimeframe(symbol, timeframe, params, '5m');
}

/**
 * Saída por compressão do spread entre MA rápida e MA lenta (15m): quando
 * |rápida−lenta|/lenta×100 &lt; `exitDiffPct` (parâmetros típicos: MA12/MA30 ou MA30/MA200).
 */
export async function shouldCloseMaCross5mByDiff(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<{ shouldClose: boolean; currentDiffPct?: number }> {
  if (timeframe !== '15m') return { shouldClose: false };

  const maFastPeriod = Number(params.ma30Period ?? 12);
  const maSlowPeriod = Number(params.ma200Period ?? 30);
  const maType: 'SMA' | 'EMA' = params.maType === 'SMA' ? 'SMA' : 'EMA';
  const exitDiffPct = Number(params.exitDiffPct ?? 0.5);
  const ma = (arr: number[], p: number) =>
    maType === 'SMA' ? calculateSMA(arr, p) : calculateLastEMA(arr, p);

  try {
    const emaCandles = Math.min(1000, Math.max(600, maSlowPeriod * 3));
    const requested =
      params.emaCandleLookback != null && Number.isFinite(Number(params.emaCandleLookback))
        ? Math.min(1500, Math.max(200, Math.floor(Number(params.emaCandleLookback))))
        : null;
    const candlesNeeded = maType === 'SMA' ? maSlowPeriod + 5 : (requested ?? emaCandles);
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < maSlowPeriod + 3) return { shouldClose: false };

    const closes = getCloses(candles);
    const closedCloses = closes.slice(0, -1);
    const maFast = ma(closedCloses, maFastPeriod);
    const maSlow = ma(closedCloses, maSlowPeriod);
    if (maFast === null || maSlow === null || maSlow === 0) return { shouldClose: false };

    const currentDiffPct = Math.abs((maFast - maSlow) / maSlow) * 100;
    return { shouldClose: currentDiffPct < exitDiffPct, currentDiffPct };
  } catch {
    return { shouldClose: false };
  }
}

export interface RunAllStrategiesOptions {
  /** Estratégias a excluir (ex: ['VOLUME_SPIKE'] para cron separado) */
  exclude?: string[];
  /** Se definido, só executa estas estratégias (por `name`) */
  only?: string[];
}

/**
 * Executa todas as estratégias ativas. Universos: ver `lib/strategyUniverses.ts`.
 */
export async function runAllStrategies(options?: RunAllStrategiesOptions): Promise<number> {
  let signalsCreated = 0;

  try {
    await ensureMissingBuiltinStrategies(prisma);

    const scanResults = await ensureAllBuiltinUniverseScans('signalEngine/runAllStrategies');
    const scanned = scanResults.filter((r) => r.action === 'scanned');
    const failed = scanResults.filter((r) => r.action === 'failed');
    if (scanned.length > 0) {
      console.log(
        `[runAllStrategies] Scanners preenchidos: ${scanned.map((r) => `${r.universeCode}=${r.rowCount}`).join(', ')}`
      );
    }
    if (failed.length > 0) {
      console.warn(
        `[runAllStrategies] Scanners em falha: ${failed.map((r) => `${r.universeCode}: ${r.reason ?? '?'}`).join('; ')}`
      );
    }

    let strategies = await prisma.strategy.findMany({
      where: { isActive: true },
    });

    strategies = strategies.filter(
      (s) =>
        (ACTIVE_SCANNER_STRATEGY_NAMES as readonly string[]).includes(s.name) &&
        !(REMOVED_DEPRECATED_STRATEGY_NAMES as readonly string[]).includes(s.name)
    );

    if (options?.only?.length) {
      strategies = strategies.filter((s) => options!.only!.includes(s.name));
      console.log(`📋 Apenas estratégias: ${options.only.join(', ')}`);
    }

    if (options?.exclude?.length) {
      strategies = strategies.filter((s) => !options!.exclude!.includes(s.name));
      console.log(`📋 Estratégias excluídas: ${options.exclude.join(', ')}`);
    }

    if (strategies.length === 0) {
      console.log('Nenhuma estratégia ativa encontrada');
      return 0;
    }

    let topMoverSymbols: string[] | null = null;
    async function loadTopMoverSymbols(): Promise<string[]> {
      if (topMoverSymbols) return topMoverSymbols;
      console.log('🔍 Buscando símbolos por variação na última hora (Binance Futures)...');
      try {
        topMoverSymbols = await fetchTopSymbolsBy1hPriceChange(150, 60);
        console.log(`✅ Encontrados ${topMoverSymbols.length} símbolos (top movers 1h)`);
      } catch (err) {
        console.warn(
          '⚠️ Top movers 1h indisponível, fallback mínimo:',
          err instanceof Error ? err.message : err
        );
        topMoverSymbols = [...TOP_MOVERS_1H_FALLBACK];
      }
      return topMoverSymbols;
    }

    const timeframes: Timeframe[] = ['1h', '4h'];
    const unknownStrategiesLogged = new Set<string>();

    for (const strategy of strategies) {
      const params = JSON.parse(strategy.params || '{}');

      if (strategy.name === 'MA_CROSS_5M' && isMaCross15mHourBlocked()) {
        console.log('⏭️ MA Cross 15m: ignorado — horário PT bloqueado');
        continue;
      }

      if (strategy.name === 'PIVOT_BOSS_BEAR_15M' && isPivotBossBear15mWeekendBlocked()) {
        console.log('⏭️ Pivot Boss Bear 15m: ignorado ao fim-de-semana (sáb/dom, horário Portugal)');
        continue;
      }

      if (strategy.name === 'PIVOT_BOSS_BEAR_15M' && isPivotBossBear15mHourBlocked()) {
        console.log('⏭️ Pivot Boss Bear 15m: ignorado — horário PT bloqueado (18h, 22h)');
        continue;
      }

      const timeframesToUse: Timeframe[] =
        strategy.name === 'MA_CROSS_5M' ? ['15m'] :
        strategy.name === 'MA_VOLATILE' ? ['1h'] :
        strategy.name === 'EMA_SCALPING' || strategy.name === 'EMA_SCALPING_SELL' ? ['15m'] :
        strategy.name === 'PIVOT_BOSS_BEAR_15M' ? ['15m'] :
        strategy.name === 'ACCUMULATION_BREAKOUT_15M' ? ['15m'] :
        strategy.name === 'SCANNER3_RSI_BREAKOUT_15M' ? ['15m'] :
        strategy.name === 'EMA80_SMA7_BREAKDOWN_15M' ? ['15m'] :
        strategy.name === 'PIVOT_BOSS_BEAR_1H' ? ['1h'] :
        strategy.name === 'MA200_VOLATILE' ? ['4h'] :
        strategy.name === 'AFASTAMENTO_MEDIO_30M' ? ['30m'] :
        strategy.name === 'MACD_HISTOGRAM_PMO' ||
        strategy.name === 'AFASTAMENTO_MEDIO' ||
        strategy.name === 'RSI_OVERBOUGHT_DROP_1H' ||
        strategy.name === 'RSI_OVERBOUGHT_DROP_LEGACY_1H'
          ? ['1h']
          : timeframes;

      let symbolsToAnalyze: string[] = [];
      let accumulationRankBySymbol: Map<string, number> | null = null;
      let scanner3RankBySymbol: Map<string, number> | null = null;

      if (strategy.name === 'EMA_SCALPING') {
        console.log(`🔍 ${strategy.name}: universo Scanner 4 (acima SMA200, 1d); sinais em 15m...`);
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D);
        console.log(`✅ EMA Ribbon Scalping BUY: ${symbolsToAnalyze.length} símbolos (Scanner 4)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 4 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 4. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'EMA_SCALPING_SELL') {
        const movers = await loadTopMoverSymbols();
        const lim = Math.min(250, Math.max(15, Math.floor(Number(params.symbolLimit ?? 80))));
        symbolsToAnalyze = movers.slice(0, lim);
        console.log(
          `✅ EMA Ribbon Scalping SELL: ${symbolsToAnalyze.length} símbolos (Top movers 1h, até ${lim})`
        );
      } else if (strategy.name === 'PIVOT_BOSS_BEAR_15M') {
        const minRank = Math.max(1, Math.floor(Number(params.minScannerRank ?? 11)));
        const maxRank = Math.max(minRank, Math.floor(Number(params.maxScannerRank ?? 40)));
        console.log(
          `🔍 ${strategy.name}: Scanner 1 ranks ${minRank}–${maxRank} (|pct vs SMA200|); sinais em 15m...`
        );
        symbolsToAnalyze = await resolveUniverseScanSymbolsRankRange(
          UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
          minRank,
          maxRank
        );
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 1 ranks ${minRank}–${maxRank})`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 1 ranks ${minRank}–${maxRank} vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'PIVOT_BOSS_BEAR_1H') {
        console.log(`🔍 ${strategy.name}: universo Scanner 4 (acima SMA200, 1d); sinais em 1h...`);
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D);
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 4)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 4 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 4. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'MA200_VOLATILE') {
        console.log(`🔍 ${strategy.name}: universo Scanner 4 (acima SMA200, 1d); sinais em 4h...`);
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D);
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 4)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 4 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 4. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'MA_CROSS_5M') {
        const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 20)));
        console.log(`🔍 ${strategy.name}: Scanner 1 top ${topN} (|pct vs SMA200|)...`);
        symbolsToAnalyze = await resolveUniverseScanSymbolsTopN(
          UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
          topN
        );
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 1 top ${topN})`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 1 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'ACCUMULATION_BREAKOUT_15M') {
        const minRank = Math.max(1, Math.floor(Number(params.minScannerRank ?? 11)));
        const maxRank = Math.max(minRank, Math.floor(Number(params.maxScannerRank ?? 40)));
        const maxStrength = Math.max(60, Math.floor(Number(params.maxStrength ?? 75)));
        console.log(
          `🔍 ${strategy.name}: Scanner 1 ranks ${minRank}–${maxRank} (|pct vs SMA200|); força máx. ${maxStrength}; sinais em 15m...`
        );
        symbolsToAnalyze = await resolveUniverseScanSymbolsRankRange(
          UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
          minRank,
          maxRank
        );
        accumulationRankBySymbol = await getUniverseScanRankMap(
          UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
          maxRank
        );
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 1 ranks ${minRank}–${maxRank})`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 1 ranks ${minRank}–${maxRank} vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'SCANNER3_RSI_BREAKOUT_15M') {
        console.log(
          `🔍 ${strategy.name}: universo Scanner 3 (RSI>75, 15m); filtro entrada RSI 72–85 + rompimento...`
        );
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_3_RSI75_15M);
        scanner3RankBySymbol = await getUniverseScanRankMap(
          UNIVERSE_CODE_SCANNER_3_RSI75_15M,
          400
        );
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 3)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 3 vazio. Corra /api/cron/run-15m ou Origem de dados → Scanner 3. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'EMA80_SMA7_BREAKDOWN_15M') {
        const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 50)));
        console.log(`🔍 ${strategy.name}: Scanner 1 top ${topN}; sinais em 15m...`);
        symbolsToAnalyze = await resolveUniverseScanSymbolsTopN(
          UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
          topN
        );
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 1 top ${topN})`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 1 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'MA_VOLATILE') {
        console.log(`🔍 MaCrossBelow na BD para ${strategy.name}...`);
        const maCrossProximity = await prisma.maCrossBelow.findMany({ orderBy: { rank: 'asc' } });
        if (maCrossProximity.length > 0) {
          symbolsToAnalyze = maCrossProximity.map((t) => t.symbol);
          console.log(`✅ ${symbolsToAnalyze.length} símbolos (MaCrossBelow)`);
        } else {
          console.warn(
            `⚠️ MaCrossBelow vazio. Ignorando ${strategy.name} (legado).`
          );
          continue;
        }
      } else if (strategy.name === 'AFASTAMENTO_MEDIO_30M') {
        console.log(`🔍 ${strategy.name}: universo Scanner 1 (acima SMA200, 1h); sinais em 30m...`);
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_1_ABOVE_MA200);
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 1)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 1 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'AFASTAMENTO_MEDIO') {
        console.log(`🔍 ${strategy.name}: universo Scanner 3 (±4% MA80, 4h); sinais em 1h...`);
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_3_MA80_PCT4);
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 3)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 3 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 3. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (
        strategy.name === 'RSI_OVERBOUGHT_DROP_1H' ||
        strategy.name === 'RSI_OVERBOUGHT_DROP_LEGACY_1H'
      ) {
        console.log(`🔍 ${strategy.name}: universo Scanner 2 (-5% a +15% EMA80, 1h)...`);
        symbolsToAnalyze = await resolveUniverseScanSymbols(UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80);
        console.log(`✅ ${symbolsToAnalyze.length} símbolos (Scanner 2)`);
        if (symbolsToAnalyze.length === 0) {
          console.warn(
            `⚠️ Scanner 2 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 2. Ignorando ${strategy.name}.`
          );
          continue;
        }
      } else if (strategy.name === 'MACD_HISTOGRAM_PMO') {
        const movers = await loadTopMoverSymbols();
        const lim = Math.min(150, Math.max(20, Math.floor(Number(params.symbolLimit ?? 50))));
        symbolsToAnalyze = movers.slice(0, lim);
        console.log(
          `✅ MACD Histogram + PMO: ${symbolsToAnalyze.length} símbolos (Top movers 1h, até ${lim})`
        );
      }

      if (symbolsToAnalyze.length === 0) {
        continue;
      }

      for (const symbol of symbolsToAnalyze) {
        for (const timeframe of timeframesToUse) {
          try {
            let signalResult: SignalResult | null = null;

            switch (strategy.name) {
              case 'MA_CROSS_5M':
                signalResult = await runMaCross15mStrategy(symbol, timeframe, params);
                break;
              case 'EMA_SCALPING':
                signalResult = await runEmaRibbonScalpingStrategy(symbol, timeframe, params);
                break;
              case 'EMA_SCALPING_SELL':
                signalResult = await runEmaRibbonScalpingSellStrategy(symbol, timeframe, params);
                break;
              case 'PIVOT_BOSS_BEAR_15M':
                signalResult = await runPivotBossBear15mStrategy(symbol, timeframe, params);
                break;
              case 'ACCUMULATION_BREAKOUT_15M':
                signalResult = await runAccumulationBreakout15mStrategy(symbol, timeframe, params);
                break;
              case 'SCANNER3_RSI_BREAKOUT_15M':
                signalResult = await runScanner3RsiBreakout15mStrategy(symbol, timeframe, params);
                break;
              case 'EMA80_SMA7_BREAKDOWN_15M':
                signalResult = await runEma80Sma7Breakdown15mStrategy(symbol, timeframe, params);
                break;
              case 'PIVOT_BOSS_BEAR_1H':
                signalResult = await runPivotBossBear1hStrategy(symbol, timeframe, params);
                break;
              case 'MA_VOLATILE':
                signalResult = await runMa60VolatileStrategy(symbol, timeframe, params);
                break;
              case 'MA200_VOLATILE':
                signalResult = await runMa200VolatileStrategy(symbol, timeframe, params);
                break;
              case 'MACD_HISTOGRAM_PMO':
                signalResult = await runMacdHistogramPmoStrategy(symbol, timeframe, params);
                break;
              case 'AFASTAMENTO_MEDIO':
                signalResult = await runAfastamentoMedioStrategy(symbol, timeframe, params);
                break;
              case 'AFASTAMENTO_MEDIO_30M':
                signalResult = await runAfastamentoMedio30mStrategy(symbol, timeframe, params);
                break;
              case 'RSI_OVERBOUGHT_DROP_1H':
                signalResult = await runRsiOverboughtDrop1hStrategy(symbol, timeframe, params);
                break;
              case 'RSI_OVERBOUGHT_DROP_LEGACY_1H':
                signalResult = await runRsiOverboughtDropLegacy1hStrategy(symbol, timeframe, params);
                break;
              default:
                if (!unknownStrategiesLogged.has(strategy.name)) {
                  unknownStrategiesLogged.add(strategy.name);
                  console.warn(`Estratégia ignorada: ${strategy.name}`);
                }
                continue;
            }

            if (signalResult) {
              console.log(
                `✅ Motor: ${strategy.name} candidato válido → ${symbol} ${signalResult.direction} (${timeframe})`
              );
            }

            if (signalResult) {
              const isMaCross12x30 = strategy.name === 'MA_CROSS_5M';
              const isPivotBoss =
                strategy.name === 'PIVOT_BOSS_BEAR_15M' ||
                strategy.name === 'PIVOT_BOSS_BEAR_1H';
              const isMacdPmo = strategy.name === 'MACD_HISTOGRAM_PMO';
              let canCreate = false;
              let skipReason = '';

              if (isMaCross12x30) {
                const gate = await checkMaCross15mSignalGate(prisma, {
                  symbol,
                  strategyId: strategy.id,
                  direction: signalResult.direction,
                  minTurnover3hUsd: Math.max(
                    0,
                    Number(params.minTurnover3hUsd ?? MA_CROSS_15M_MIN_TURNOVER_1H_USD)
                  ),
                });
                canCreate = gate.allowed;
                if (!gate.allowed) skipReason = gate.reason;
              } else if (isPivotBoss) {
                const gate = await checkPivotBossDailySignalGate(prisma, {
                  symbol,
                  strategyId: strategy.id,
                  timeframe,
                });
                canCreate = gate.allowed;
                if (!gate.allowed) skipReason = gate.reason;
              } else {
                const dedupMs = isMacdPmo
                  ? Math.max(1, Number(params.signalCooldownHours ?? 4)) * 60 * 60 * 1000
                  : 2 * 60 * 60 * 1000;

                const recentSignal = await prisma.signal.findFirst({
                  where: {
                    symbol,
                    strategyId: strategy.id,
                    timeframe,
                    direction: signalResult.direction,
                    ...(isMacdPmo ? {} : { status: { in: ['NEW', 'IN_PROGRESS'] } }),
                    generatedAt: {
                      gte: new Date(Date.now() - dedupMs),
                    },
                  },
                });

                canCreate = !recentSignal;
                if (recentSignal) {
                  const h = dedupMs / (60 * 60 * 1000);
                  skipReason = `cooldown ${h}h`;
                }
              }

              if (canCreate) {
                let extraInfo = signalResult.extraInfo;
                if (
                  strategy.name === 'ACCUMULATION_BREAKOUT_15M' &&
                  accumulationRankBySymbol?.has(symbol)
                ) {
                  try {
                    const parsed = JSON.parse(signalResult.extraInfo || '{}');
                    extraInfo = JSON.stringify({
                      ...parsed,
                      scannerRank: accumulationRankBySymbol.get(symbol),
                    });
                  } catch {
                    extraInfo = signalResult.extraInfo;
                  }
                } else if (
                  strategy.name === 'SCANNER3_RSI_BREAKOUT_15M' &&
                  scanner3RankBySymbol?.has(symbol)
                ) {
                  try {
                    const parsed = JSON.parse(signalResult.extraInfo || '{}');
                    extraInfo = JSON.stringify({
                      ...parsed,
                      scannerRank: scanner3RankBySymbol.get(symbol),
                    });
                  } catch {
                    extraInfo = signalResult.extraInfo;
                  }
                }

                await prisma.signal.create({
                  data: {
                    symbol,
                    direction: signalResult.direction,
                    timeframe,
                    strategyId: strategy.id,
                    strategyName: strategy.displayName,
                    entryPrice: signalResult.entryPrice,
                    stopLoss: signalResult.stopLoss,
                    target1: signalResult.target1,
                    target2: signalResult.target2,
                    target3: signalResult.target3,
                    strength: signalResult.strength,
                    status: 'NEW',
                    extraInfo,
                  },
                });
                signalsCreated++;
                console.log(`✅ Sinal criado: ${symbol} ${signalResult.direction} (${strategy.displayName})`);
              } else {
                console.log(
                  `⏭️ Sinal duplicado ignorado: ${symbol} ${signalResult.direction}` +
                    (skipReason ? ` (${skipReason})` : '')
                );
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Erro ${strategy.name} ${symbol} ${timeframe}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro ao executar estratégias:', error);
    throw error;
  }

  return signalsCreated;
}
