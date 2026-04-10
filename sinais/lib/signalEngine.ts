/**
 * Motor de geração de sinais - RSI + Volume Spike
 */

import { prisma } from './db';
import { fetchCandles, fetchTopSymbolsBy1hPriceChange, fetchTopSymbolsBy24hPriceChange, fetchTopSymbolsByVolume, type Timeframe } from './marketData';
import {
  calculateRSI,
  calculateSMA,
  getCloses,
  getVolumes,
  calculateVolumeMA,
} from './indicators';

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
 * Estratégia Volume Spike 15m (15 períodos):
 * BUY  (candle verde + vol >20x + vol >2M)  → SL -8% | TP1 +11% (30%) | TP2 +23% (40%) | 30% às 24h
 * SELL (candle vermelho + vol >20x)          → SL +7% | TP1 -10% (60%) | TP2 -11% (30%)
 */
export async function runVolumeSpike15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') {
    return null;
  }

  const configuredMultiplier = Number(params.volumeMultiplier ?? 20);
  const volumeMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? Math.max(20, configuredMultiplier)
    : 20;
  const lookbackPeriods  = params.lookbackPeriods  ?? 15;
  const ma200Period      = params.ma200Period       ?? 200;
  const buyMa200PctAbove = params.buyMa200PctAbove  ?? 8;  // % acima da MA200 para confirmar SELL invertido

  try {
    const candlesNeeded = Math.max(ma200Period + 5, lookbackPeriods + 5);
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);

    if (candles.length < ma200Period + 2) {
      return null;
    }

    const volumes = getVolumes(candles);
    const lastClosedIndex = volumes.length - 2;
    const currentVolume = volumes[lastClosedIndex];

    const volumesForAverage = volumes.slice(-lookbackPeriods - 2, -2);
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackPeriods);

    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    const volumeRatio = currentVolume / volumeAverage;
    if (volumeRatio < volumeMultiplier) {
      return null;
    }

    const closes      = getCloses(candles);
    const closedCloses = closes.slice(0, -1);
    const ma200        = calculateSMA(closedCloses, ma200Period);

    const currentPrice = candles[lastClosedIndex].close;
    const prevPrice    = candles[lastClosedIndex - 1].close;
    const priceChange  = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    if (direction === 'BUY') {
      if (currentVolume < 2_000_000) {
        return null;
      }

      const stopLoss = currentPrice * 0.92;   // SL -8%
      const target1  = currentPrice * 1.11;   // TP1 +11% — 30% posição
      const target2  = currentPrice * 1.23;   // TP2 +23% — 40% posição (30% fecha às 24h)
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
          lookbackPeriods,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
          executionProfile: 'BUY signal | SL -8% | TP1 +11% (30%) | TP2 +23% (40%) | 30% às 24h',
          sl: 8, tp1Percent: 11, tp1Position: 30,
          tp2Percent: 23, tp2Position: 40,
          tp3: '30% às 24h',
        }),
      };
    } else {
      const stopLoss = currentPrice * 1.07;
      const target1 = currentPrice * 0.90;
      const target2 = currentPrice * 0.89;
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
          lookbackPeriods,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
          executionProfile: 'SELL signal | SL 7% | TP1 10% | TP2 11%',
          originalDirection: 'SELL',
        }),
      };
    }
  } catch (error) {
    console.error(`Erro na estratégia Volume Spike 15m para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia MA Cross Top Voláteis (mesma lógica da MA200_VOLATILE, usando MA60 em 1h):
 * - BUY : fecha 2%+ ACIMA da MA60  → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% fecha na reversão
 * - SELL: fecha 2%+ ABAIXO da MA60 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% fecha na reversão
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
  const buyStopPercent    = params.buyStopPercent    ?? 8;
  const buyTp1Percent     = params.buyTp1Percent     ?? 8;
  const buyTp1Position    = params.buyTp1Position    ?? 40;
  const buyTp2Percent     = params.buyTp2Percent     ?? 15;
  const buyTp2Position    = params.buyTp2Position    ?? 30;
  const sellStopPercent   = params.sellStopPercent   ?? 8;
  const sellTp1Percent    = params.sellTp1Percent    ?? 9;
  const sellTp1Position   = params.sellTp1Position   ?? 40;
  const sellTp2Percent    = params.sellTp2Percent    ?? 17;
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
 *         SL -11% | sem TP intermédio | entrada só se distância à MA200 < 10% | saída na reversão
 * - SELL: preço fecha 2%+ ABAIXO da MA200 (cruzamento confirmado)
 *         SL +11% | sem TP intermédio | entrada só se distância à MA200 < 10% | saída na reversão
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
  const buyStopPercent    = params.buyStopPercent    ?? 11;

  // Parâmetros VENDA
  const sellStopPercent   = params.sellStopPercent   ?? 11;

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
      const distPct  = ((currentPrice - ma200) / ma200 * 100).toFixed(2);

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1: undefined,
        target2: undefined,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma200: ma200.toFixed(4),
          distFromMA200: `+${distPct}%`,
          crossover: `closed candle crosses +${confirmationPct}% above MA200 (reversal BUY)`,
          stopPercent: buyStopPercent,
          maxDistancePct,
          executionProfile: `SL -${buyStopPercent}% | sem TP intermédio | entrada só se distância < ${maxDistancePct}% | saída na reversão`,
        }),
      };
    }

    // VENDA: vela fechada cruza MA200 para baixo E fecha 2%+ abaixo (reversão confirmada de BUY → SELL)
    if (prevPrice >= prevMa200 && currentPrice < confirmDown) {
      const stopLoss = currentPrice * (1 + sellStopPercent / 100);
      const distPct  = ((ma200 - currentPrice) / ma200 * 100).toFixed(2);

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1: undefined,
        target2: undefined,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma200: ma200.toFixed(4),
          distFromMA200: `-${distPct}%`,
          crossover: `closed candle crosses -${confirmationPct}% below MA200 (reversal SELL)`,
          stopPercent: sellStopPercent,
          maxDistancePct,
          executionProfile: `SL +${sellStopPercent}% | sem TP intermédio | entrada só se distância < ${maxDistancePct}% | saída na reversão`,
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
 * Estratégia RSI — Top Volatilidade 1h:
 * BUY  quando RSI cruza de baixo para cima 60  → SL -3% | sem TP intermédio | saída às 24h
 * SELL quando RSI cruza de cima para baixo 40  → SL +3% | sem TP intermédio | saída às 24h
 * Usa sempre o candle fechado (não o em formação).
 * Corre apenas em símbolos Top Volatilidade (filtrado em runAllStrategies).
 */
export async function runRsiStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const period        = params.period        ?? 14;
  const buyThreshold  = params.buyThreshold  ?? 60;
  const sellThreshold = params.sellThreshold ?? 40;
  const maPeriod      = params.maPeriod      ?? 200;
  const buyStopPercent = params.buyStopPercent ?? 3;
  const sellStopPercent = params.sellStopPercent ?? 3;
  const closeAfterHours = params.closeAfterHours ?? 24;

  try {
    const candlesNeeded = Math.max(period + 25, maPeriod + 5);
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < maPeriod + 3) return null;

    const closes = getCloses(candles);

    // Usa candle fechado: exclui o candle ainda em formação
    const closedCloses     = closes.slice(0, -1);
    const prevClosedCloses = closes.slice(0, -2);

    const rsi     = calculateRSI(closedCloses,     period);
    const prevRsi = calculateRSI(prevClosedCloses,  period);
    const ma200   = calculateSMA(closedCloses, maPeriod);
    if (rsi === null || prevRsi === null || ma200 === null) return null;

    const currentPrice = candles[candles.length - 2].close; // último candle fechado

    // BUY: RSI cruza de baixo para cima 60 E preço acima MA200
    if (prevRsi <= buyThreshold && rsi > buyThreshold && currentPrice > ma200) {
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice * (1 - buyStopPercent / 100),
        target1:  undefined,
        target2:  undefined,
        target3:  undefined,
        strength: Math.min(100, Math.max(60, Math.round(60 + (rsi - buyThreshold) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsi.toFixed(2),
          prevRsi: prevRsi.toFixed(2),
          buyThreshold,
          ma200: ma200.toFixed(4),
          stopPercent: buyStopPercent,
          executionProfile: `SL -${buyStopPercent}% | sem TP intermédio | saída às ${closeAfterHours}h`,
          timeExit: `100% às ${closeAfterHours}h`,
        }),
      };
    }

    // SELL: RSI cruza de cima para baixo 40 E preço abaixo MA200
    if (prevRsi >= sellThreshold && rsi < sellThreshold && currentPrice < ma200) {
      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss: currentPrice * (1 + sellStopPercent / 100),
        target1:  undefined,
        target2:  undefined,
        target3:  undefined,
        strength: Math.min(100, Math.max(60, Math.round(60 + (sellThreshold - rsi) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsi.toFixed(2),
          prevRsi: prevRsi.toFixed(2),
          sellThreshold,
          ma200: ma200.toFixed(4),
          stopPercent: sellStopPercent,
          executionProfile: `SL +${sellStopPercent}% | sem TP intermédio | saída às ${closeAfterHours}h`,
          timeExit: `100% às ${closeAfterHours}h`,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia RSI para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia RSI 15m — Reversal oversold:
 * BUY quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32
 * Apenas BUY | SL -3% | TP1 +5% | TP2 +14%
 * Usa sempre o candle fechado (não o em formação).
 * Sem filtro MA200 para sinal mais rápido.
 * Corre num universo alargado de símbolos líquidos (filtrado em runAllStrategies).
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

export interface RunAllStrategiesOptions {
  /** Estratégias a excluir (ex: ['VOLUME_SPIKE'] para cron separado) */
  exclude?: string[];
}

/**
 * Executa todas as estratégias ativas (RSI, Volume Spike 1h, Volume Spike 15m)
 */
export async function runAllStrategies(options?: RunAllStrategiesOptions): Promise<number> {
  let signalsCreated = 0;

  try {
    let strategies = await prisma.strategy.findMany({
      where: { isActive: true },
    });

    if (options?.exclude?.length) {
      strategies = strategies.filter((s) => !options!.exclude!.includes(s.name));
      console.log(`📋 Estratégias excluídas: ${options.exclude.join(', ')}`);
    }

    if (strategies.length === 0) {
      console.log('Nenhuma estratégia ativa encontrada');
      return 0;
    }

    console.log('🔍 Buscando símbolos por variação na última hora (Binance Futures)...');
    let symbols: string[] = [];
    try {
      symbols = await fetchTopSymbolsBy1hPriceChange(150, 250);
      console.log(`✅ Encontrados ${symbols.length} símbolos`);
    } catch (err) {
      console.error('Erro ao buscar símbolos, usando fallback:', err);
      symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
    }

    const timeframes: Timeframe[] = ['1h', '4h'];
    const unknownStrategiesLogged = new Set<string>();

    for (const strategy of strategies) {
      const params = JSON.parse(strategy.params || '{}');

      const timeframesToUse: Timeframe[] =
        strategy.name === 'VOLUME_SPIKE_15M' ? ['15m'] :
        strategy.name === 'MA_VOLATILE'      ? ['1h'] :
        strategy.name === 'RSI_15M'          ? ['15m'] :
        strategy.name === 'MA200_VOLATILE'   ? ['4h'] :
        strategy.name === 'RSI'              ? ['1h'] : timeframes;

      let symbolsToAnalyze = symbols;
      if (strategy.name === 'VOLUME_SPIKE' || strategy.name === 'VOLUME_SPIKE_15M') {
        const maxSymbols = 500;
        const minQuoteVolume = 100000;
        console.log(`🔍 Buscando símbolos por % variação 24h para ${strategy.name}...`);
        const volumeSymbols = await fetchTopSymbolsBy24hPriceChange(maxSymbols, minQuoteVolume);
        if (volumeSymbols.length > 0) {
          symbolsToAnalyze = volumeSymbols;
          console.log(`✅ Encontrados ${volumeSymbols.length} símbolos`);
        }
      } else if (strategy.name === 'RSI_15M') {
        const maxSymbols = params.symbolLimit ?? 400;
        const minQuoteVolume = params.minQuoteVolume ?? 500000;
        console.log(`🔍 Buscando universo alargado para ${strategy.name} (${maxSymbols} símbolos)...`);
        try {
          const broadSymbols = await fetchTopSymbolsByVolume(maxSymbols, minQuoteVolume);
          if (broadSymbols.length > 0) {
            symbolsToAnalyze = broadSymbols;
            console.log(`✅ Encontrados ${broadSymbols.length} símbolos líquidos`);
          }
        } catch (err) {
          console.warn(`⚠️ Falha ao ampliar universo de ${strategy.name}, usando lista base:`, err);
        }
      } else if (strategy.name === 'MA200_VOLATILE') {
        const maxSymbols = params.symbolLimit ?? 500;
        const minQuoteVolume = params.minQuoteVolume ?? 100000;
        console.log(`🔍 Buscando universo alargado para ${strategy.name} (${maxSymbols} símbolos)...`);
        try {
          const broadSymbols = await fetchTopSymbolsByVolume(maxSymbols, minQuoteVolume);
          if (broadSymbols.length > 0) {
            symbolsToAnalyze = broadSymbols;
            console.log(`✅ Encontrados ${broadSymbols.length} símbolos líquidos`);
          }
        } catch (err) {
          console.warn(`⚠️ Falha ao ampliar universo de ${strategy.name}, usando Top Voláteis:`, err);
        }
      } else if (
        strategy.name === 'MA_VOLATILE' ||
        strategy.name === 'RSI'
      ) {
        console.log(`🔍 Buscando Top Voláteis na BD para ${strategy.name}...`);
        const topVolatile = await prisma.topVolatile.findMany({ orderBy: { rank: 'asc' } });
        if (topVolatile.length > 0) {
          symbolsToAnalyze = topVolatile.map((t) => t.symbol);
          console.log(`✅ Encontradas ${symbolsToAnalyze.length} Top Voláteis`);
        } else {
          console.warn(`⚠️ Nenhuma Top Volátil na BD. Execute "Atualizar Top Volatilidade" antes. Ignorando ${strategy.name}.`);
          continue;
        }
      }

      for (const symbol of symbolsToAnalyze) {
        for (const timeframe of timeframesToUse) {
          try {
            let signalResult: SignalResult | null = null;

            switch (strategy.name) {
              case 'VOLUME_SPIKE':
                signalResult = await runVolumeSpikeStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'VOLUME_SPIKE_15M':
                signalResult = await runVolumeSpike15mStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike 15m: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'RSI':
                signalResult = await runRsiStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ RSI: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'RSI_15M':
                signalResult = await runRsi15mStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ RSI 15m: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'MA_VOLATILE':
                signalResult = await runMa60VolatileStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ MA Voláteis: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'MA200_VOLATILE':
                signalResult = await runMa200VolatileStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ MA200 Voláteis: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              default:
                if (!unknownStrategiesLogged.has(strategy.name)) {
                  unknownStrategiesLogged.add(strategy.name);
                  console.warn(`Estratégia ignorada: ${strategy.name}`);
                }
                continue;
            }

            // Filtrar direção com base em allowBuy / allowSell dos params
            if (signalResult) {
              const allowBuy  = params.allowBuy  !== false;
              const allowSell = params.allowSell !== false;
              if (
                (signalResult.direction === 'BUY'  && !allowBuy) ||
                (signalResult.direction === 'SELL' && !allowSell)
              ) {
                signalResult = null;
              }
              if (!signalResult) continue;
            }

            if (signalResult) {
              const recentSignal = await prisma.signal.findFirst({
                where: {
                  symbol,
                  strategyId: strategy.id,
                  timeframe,
                  direction: signalResult.direction,
                  status: { in: ['NEW', 'IN_PROGRESS'] },
                  generatedAt: {
                    gte: new Date(Date.now() - 2 * 60 * 60 * 1000),
                  },
                },
              });

              if (!recentSignal) {
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
                    extraInfo: signalResult.extraInfo,
                  },
                });
                signalsCreated++;
                console.log(`✅ Sinal criado: ${symbol} ${signalResult.direction} (${strategy.displayName})`);
              } else {
                console.log(`⏭️ Sinal duplicado ignorado: ${symbol} ${signalResult.direction}`);
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
