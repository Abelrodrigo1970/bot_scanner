/**
 * Estratégias importadas de crypto-sinais-automaticos (MACD+PMO, afastamento, RSI queda 70).
 */

import { fetchCandles, type Timeframe } from './marketData';
import {
  calculateMACD,
  calculatePMO,
  calculateRSI,
  calculateSMA,
  calculateEMA,
  getCloses,
  getSmaPercentDistanceSeries,
  getEmaPercentDistanceSeries,
  smaTail,
} from './indicators';
import type { SignalResult, StrategyParams } from './signalEngine';

export async function runMacdHistogramPmoStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const fastPeriod = params.fastPeriod || 12;
  const slowPeriod = params.slowPeriod || 26;
  const signalPeriod = params.signalPeriod || 9;
  const pmoBuyThreshold = params.pmoBuyThreshold ?? -0.5;
  const pmoSellThreshold = params.pmoSellThreshold ?? 0.5;
  const pmoFirstLength = params.rocPeriodPmo || 35;
  const pmoSecondLength = params.emaFastPmo || 20;

  try {
    const maxPeriod = Math.max(slowPeriod + signalPeriod, pmoFirstLength + pmoSecondLength) + 20;
    const candles = await fetchCandles(symbol, timeframe, maxPeriod);
    if (candles.length < maxPeriod) return null;

    const closes = getCloses(candles);
    const macd = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);
    if (macd === null) return null;

    const prevCloses = closes.slice(0, -1);
    const prevMacd = calculateMACD(prevCloses, fastPeriod, slowPeriod, signalPeriod);
    if (prevMacd === null) return null;

    const pmo = calculatePMO(closes, pmoFirstLength, pmoSecondLength);
    if (pmo === null) return null;

    const currentPrice = candles[candles.length - 1].close;

    if (prevMacd.histogram < 0 && macd.histogram > 0 && pmo > pmoBuyThreshold) {
      const stopLoss = currentPrice * 0.96;
      const target1 = currentPrice * 1.2;
      const histogramStrength = Math.min(50, Math.round(Math.abs(macd.histogram) * 1000));
      const pmoStrength = Math.min(50, Math.round((pmo - pmoBuyThreshold) * 20));
      const strength = Math.min(100, Math.max(60, histogramStrength + pmoStrength));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: target1,
        target3: target1,
        strength,
        extraInfo: JSON.stringify({
          macd: macd.macd.toFixed(4),
          signal: macd.signal.toFixed(4),
          histogram: macd.histogram.toFixed(4),
          prevHistogram: prevMacd.histogram.toFixed(4),
          pmo: pmo.toFixed(4),
          pmoBuyThreshold,
        }),
      };
    }

    if (prevMacd.histogram > 0 && macd.histogram < 0 && pmo < pmoSellThreshold) {
      const stopLoss = currentPrice * 1.04;
      const target1 = currentPrice * 0.8;
      const histogramStrength = Math.min(50, Math.round(Math.abs(macd.histogram) * 1000));
      const pmoStrength = Math.min(50, Math.round((pmoSellThreshold - pmo) * 20));
      const strength = Math.min(100, Math.max(60, histogramStrength + pmoStrength));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: target1,
        target3: target1,
        strength,
        extraInfo: JSON.stringify({
          macd: macd.macd.toFixed(4),
          signal: macd.signal.toFixed(4),
          histogram: macd.histogram.toFixed(4),
          prevHistogram: prevMacd.histogram.toFixed(4),
          pmo: pmo.toFixed(4),
          pmoSellThreshold,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro MACD Histogram + PMO ${symbol}:`, error);
    return null;
  }
}

export async function runRsiOverboughtDrop1hStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const rsiPeriod = Math.max(2, Number(params.rsiPeriod) || 14);
  const overboughtLevel = Number(params.overboughtLevel ?? 70);
  const minDropPoints = Math.max(1, Number(params.minDropPoints) || 4);
  const minDistancePct = Number(params.minDistancePct ?? 12);
  const maPeriod = Math.max(2, Number(params.maPeriod) || 80);
  const meanLineType =
    String(params.meanLineType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const stopLossPct = Number(params.stopLossPct ?? 0.06);

  try {
    const candlesNeeded = Math.max(maPeriod, rsiPeriod) + 50;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < Math.max(maPeriod, rsiPeriod) + 5) return null;

    const closes = getCloses(candles);
    const rsiCurr = calculateRSI(closes, rsiPeriod);
    const rsiPrev = calculateRSI(closes.slice(0, -1), rsiPeriod);
    if (rsiCurr === null || rsiPrev === null) return null;

    const drop = rsiPrev - rsiCurr;
    const crossedDownFromOverbought =
      rsiPrev >= overboughtLevel && rsiCurr < overboughtLevel && drop >= minDropPoints;
    if (!crossedDownFromOverbought) return null;

    const distances =
      meanLineType === 'SMA'
        ? getSmaPercentDistanceSeries(closes, maPeriod)
        : getEmaPercentDistanceSeries(closes, maPeriod);
    if (distances.length < 1) return null;
    const currDist = distances[distances.length - 1];
    if (!(currDist > minDistancePct)) return null;

    let meanAtClose: number | null = null;
    if (meanLineType === 'EMA') {
      const em = calculateEMA(closes, maPeriod);
      meanAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      meanAtClose = calculateSMA(closes, maPeriod);
    }
    if (meanAtClose === null || meanAtClose === 0) return null;

    const currentPrice = candles[candles.length - 1].close;
    const stopLoss = currentPrice * (1 + stopLossPct);
    const target1 = meanAtClose;
    const strength = Math.min(
      100,
      Math.max(
        70,
        Math.round(
          70 +
            Math.min(drop - minDropPoints, 8) * 2 +
            Math.min(Math.max(currDist - minDistancePct, 0), 18)
        )
      )
    );

    return {
      direction: 'SELL',
      entryPrice: currentPrice,
      stopLoss,
      target1,
      target2: target1,
      target3: target1,
      strength,
      extraInfo: JSON.stringify({
        setup: 'rsi_overbought_drop_distance_ma',
        rsiPeriod,
        overboughtLevel,
        minDropPoints,
        minDistancePct,
        rsiPrev: rsiPrev.toFixed(2),
        rsiCurr: rsiCurr.toFixed(2),
        drop: drop.toFixed(2),
        distancePct: currDist.toFixed(3),
        meanLineType,
        maPeriod,
        stopLossPct,
      }),
    };
  } catch (error) {
    console.error(`Erro RSI queda 70 + afastamento ${symbol}:`, error);
    return null;
  }
}

export async function runAfastamentoMedioStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const maPeriod = Math.max(2, Number(params.maPeriod) || 80);
  const smoothPeriod = Math.max(2, Number(params.smoothPeriod) || 7);
  const upperThreshold = Number(params.upperThresholdPct ?? 60);
  const buyTrendMaPeriod = Math.max(2, Number(params.buyTrendMaPeriod) || 30);
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 2);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 3);
  const meanLineType =
    String(params.meanLineType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const trendMaType =
    String(params.trendMaType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const requireSmoothCross =
    params.requireSmoothCross === true || params.requireSmoothCross === 'true';

  const candlesNeeded = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 40;
  try {
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    const minCloses = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 3;
    if (candles.length < minCloses) return null;

    const closes = getCloses(candles);
    const distances =
      meanLineType === 'SMA'
        ? getSmaPercentDistanceSeries(closes, maPeriod)
        : getEmaPercentDistanceSeries(closes, maPeriod);
    if (distances.length < smoothPeriod + 2) return null;

    const currDist = distances[distances.length - 1];
    const prevDist = distances[distances.length - 2];
    const smoothCurr = smaTail(distances, smoothPeriod);
    const smoothPrev = smaTail(distances.slice(0, -1), smoothPeriod);
    if (smoothCurr === null || smoothPrev === null) return null;

    const currentPrice = candles[candles.length - 1].close;

    let meanAtClose: number | null = null;
    if (meanLineType === 'EMA') {
      const em = calculateEMA(closes, maPeriod);
      meanAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      meanAtClose = calculateSMA(closes, maPeriod);
    }

    let trendAtClose: number | null = null;
    if (trendMaType === 'EMA') {
      const em = calculateEMA(closes, buyTrendMaPeriod);
      trendAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      trendAtClose = calculateSMA(closes, buyTrendMaPeriod);
    }

    if (
      meanAtClose === null ||
      meanAtClose === 0 ||
      trendAtClose === null ||
      trendAtClose === 0
    ) {
      return null;
    }

    const extraBase = {
      maPeriod,
      smoothPeriod,
      meanLineType,
      trendMaType,
      distancePct: currDist.toFixed(3),
      prevDistancePct: prevDist.toFixed(3),
      smoothDistancePct: smoothCurr.toFixed(3),
      prevSmoothDistancePct: smoothPrev.toFixed(3),
      meanAtClose: meanAtClose.toFixed(8),
      trendMaPeriod: buyTrendMaPeriod,
      trendAtClose: trendAtClose.toFixed(8),
      upperThreshold,
      buySmoothPrevMax,
      buySmoothCurrMin,
    };

    const crossShort =
      prevDist <= upperThreshold &&
      currDist > upperThreshold &&
      (!requireSmoothCross ||
        (smoothPrev <= upperThreshold && smoothCurr > upperThreshold));

    if (crossShort) {
      const stopLoss = currentPrice * 1.04;
      const target1 = meanAtClose;
      const overshoot = currDist - upperThreshold;
      const strength = Math.min(100, Math.max(60, Math.round(65 + Math.min(overshoot, 40))));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: target1,
        target3: target1,
        strength,
        extraInfo: JSON.stringify({ ...extraBase, setup: 'mean_reversion_short' }),
      };
    }

    const buyCrossSmooth2To3 =
      smoothPrev <= buySmoothPrevMax && smoothCurr >= buySmoothCurrMin;

    if (buyCrossSmooth2To3 && currentPrice > trendAtClose) {
      const stopLoss = currentPrice * 0.96;
      const target1 = currentPrice * 1.2;
      const rise = smoothCurr - smoothPrev;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(rise, 0) * 10, 25)))
      );

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: target1,
        target3: target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'smooth_cross_2_to_3_above_ma30',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro Afastamento Médio ${symbol}:`, error);
    return null;
  }
}

function sideEnabled(
  direction: 'BUY' | 'SELL',
  params: StrategyParams
): boolean {
  if (direction === 'BUY') {
    return params.allowBuy !== false && params.buyEnabled !== false;
  }
  return params.allowSell !== false && params.sellEnabled !== false;
}

export async function runAfastamentoMedio30mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '30m') return null;

  const maPeriod = Math.max(2, Number(params.maPeriod) || 80);
  const smoothPeriod = Math.max(2, Number(params.smoothPeriod) || 7);
  const buyTrendMaPeriod = Math.max(2, Number(params.buyTrendMaPeriod) || 30);
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 1);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 2);
  const sellSmoothPrevMax = Number(params.sellSmoothPrevMax ?? 2);
  const sellSmoothCurrMin = Number(params.sellSmoothCurrMin ?? 2.5);
  const stopLossPct = Math.min(0.5, Math.max(0.001, Number(params.stopLossPct ?? 0.06)));
  const takeProfitPct = Math.min(1, Math.max(0.001, Number(params.takeProfitPct ?? 0.18)));
  const meanLineType =
    String(params.meanLineType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const trendMaType =
    String(params.trendMaType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';

  const candlesNeeded = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 40;
  try {
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    const minCloses = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 3;
    if (candles.length < minCloses) return null;

    const closes = getCloses(candles);
    const distances =
      meanLineType === 'SMA'
        ? getSmaPercentDistanceSeries(closes, maPeriod)
        : getEmaPercentDistanceSeries(closes, maPeriod);
    if (distances.length < smoothPeriod + 2) return null;

    const smoothCurr = smaTail(distances, smoothPeriod);
    const smoothPrev = smaTail(distances.slice(0, -1), smoothPeriod);
    if (smoothCurr === null || smoothPrev === null) return null;

    const currentPrice = candles[candles.length - 1].close;

    let meanAtClose: number | null = null;
    if (meanLineType === 'EMA') {
      const em = calculateEMA(closes, maPeriod);
      meanAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      meanAtClose = calculateSMA(closes, maPeriod);
    }

    let trendAtClose: number | null = null;
    if (trendMaType === 'EMA') {
      const em = calculateEMA(closes, buyTrendMaPeriod);
      trendAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      trendAtClose = calculateSMA(closes, buyTrendMaPeriod);
    }

    if (
      meanAtClose === null ||
      meanAtClose === 0 ||
      trendAtClose === null ||
      trendAtClose === 0
    ) {
      return null;
    }

    const extraBase = {
      maPeriod,
      smoothPeriod,
      meanLineType,
      trendMaType,
      smoothDistancePct: smoothCurr.toFixed(3),
      prevSmoothDistancePct: smoothPrev.toFixed(3),
      buySmoothPrevMax,
      buySmoothCurrMin,
      sellSmoothPrevMax,
      sellSmoothCurrMin,
    };

    const sellCrossSmooth2To25 =
      smoothPrev <= sellSmoothPrevMax && smoothCurr >= sellSmoothCurrMin;

    if (
      sideEnabled('SELL', params) &&
      sellCrossSmooth2To25 &&
      currentPrice < meanAtClose &&
      currentPrice < trendAtClose
    ) {
      const stopLoss = currentPrice * (1 + stopLossPct);
      const target1 = currentPrice * (1 - takeProfitPct);
      const rise = smoothCurr - smoothPrev;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(rise, 0) * 10, 25)))
      );

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'smooth_cross_2_to_2_5_below_ma80_ma30',
          stopLossPct,
          takeProfitPct,
        }),
      };
    }

    const buyCrossSmooth1To2 =
      smoothPrev <= buySmoothPrevMax && smoothCurr >= buySmoothCurrMin;

    if (
      sideEnabled('BUY', params) &&
      buyCrossSmooth1To2 &&
      currentPrice > meanAtClose &&
      currentPrice > trendAtClose
    ) {
      const stopLoss = currentPrice * (1 - stopLossPct);
      const target1 = currentPrice * (1 + takeProfitPct);
      const rise = smoothCurr - smoothPrev;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(rise, 0) * 10, 25)))
      );

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'smooth_cross_1_to_2_above_trend_ma_30m',
          stopLossPct,
          takeProfitPct,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro Afastamento Médio 30m ${symbol}:`, error);
    return null;
  }
}
