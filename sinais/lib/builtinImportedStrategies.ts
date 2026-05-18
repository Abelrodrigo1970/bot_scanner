/**
 * Estratégias importadas de crypto-sinais-automaticos (MACD+PMO, afastamento, RSI queda 70).
 */

import { dropFormingCandle, fetchCandles, type Timeframe } from './marketData';
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

function paramFlag(value: unknown, defaultTrue: boolean): boolean {
  if (value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  return defaultTrue;
}

export async function runMacdHistogramPmoStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const fastPeriod = params.fastPeriod || 12;
  const slowPeriod = params.slowPeriod || 26;
  const signalPeriod = params.signalPeriod || 9;
  const pmoBuyThreshold = params.pmoBuyThreshold ?? 0;
  const pmoSellThreshold = params.pmoSellThreshold ?? 0;
  const pmoFirstLength = params.rocPeriodPmo || 35;
  const pmoSecondLength = params.emaFastPmo || 20;
  const minHistogramAbs = Math.max(0, Number(params.minHistogramAbs ?? 0));
  const useClosedCandleOnly = paramFlag(params.useClosedCandleOnly, true);
  const requireMacdLineConfirm = paramFlag(params.requireMacdLineConfirm, true);
  const requirePmoMomentum = paramFlag(params.requirePmoMomentum, true);

  try {
    const maxPeriod = Math.max(slowPeriod + signalPeriod, pmoFirstLength + pmoSecondLength) + 20;
    let candles = await fetchCandles(symbol, timeframe, maxPeriod + 2);
    if (useClosedCandleOnly) {
      candles = dropFormingCandle(candles, timeframe);
    }
    if (candles.length < maxPeriod) return null;

    const closes = getCloses(candles);
    const macd = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);
    if (macd === null) return null;

    const prevCloses = closes.slice(0, -1);
    const prevMacd = calculateMACD(prevCloses, fastPeriod, slowPeriod, signalPeriod);
    if (prevMacd === null) return null;

    const pmo = calculatePMO(closes, pmoFirstLength, pmoSecondLength);
    if (pmo === null) return null;

    const pmoPrev = requirePmoMomentum
      ? calculatePMO(prevCloses, pmoFirstLength, pmoSecondLength)
      : null;

    const currentPrice = candles[candles.length - 1].close;

    const histogramCrossUp =
      prevMacd.histogram < 0 &&
      macd.histogram > 0 &&
      (minHistogramAbs <= 0 || Math.abs(macd.histogram) >= minHistogramAbs);
    const macdLineBullish = !requireMacdLineConfirm || macd.macd > macd.signal;
    const pmoBullish =
      pmo > pmoBuyThreshold &&
      (!requirePmoMomentum || (pmoPrev !== null && pmo > pmoPrev));

    if (histogramCrossUp && macdLineBullish && pmoBullish) {
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

    const histogramCrossDown =
      prevMacd.histogram > 0 &&
      macd.histogram < 0 &&
      (minHistogramAbs <= 0 || Math.abs(macd.histogram) >= minHistogramAbs);
    const macdLineBearish = !requireMacdLineConfirm || macd.macd < macd.signal;
    const pmoBearish =
      pmo < pmoSellThreshold &&
      (!requirePmoMomentum || (pmoPrev !== null && pmo < pmoPrev));

    if (histogramCrossDown && macdLineBearish && pmoBearish) {
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
  const stopLossPct = Number(params.stopLossPct ?? 0.08);
  const sellTp1Percent = Number(params.sellTp1Percent ?? 9);
  const sellTp2Percent = Number(params.sellTp2Percent ?? 19);
  const sellTp1Position = Math.min(100, Math.max(1, Number(params.sellTp1Position ?? 30)));
  const sellTp2Position = Math.min(100, Math.max(1, Number(params.sellTp2Position ?? 40)));

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
    const target1 = currentPrice * (1 - sellTp1Percent / 100);
    const target2 = currentPrice * (1 - sellTp2Percent / 100);
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
      target2,
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
        meanAtClose: meanAtClose.toFixed(8),
        stopLossPct,
        sellTp1Percent,
        sellTp2Percent,
        sellTp1Position,
        sellTp2Position,
        tp1Position: sellTp1Position,
        tp2Position: sellTp2Position,
        manualRemainderPct: Math.max(0, 100 - sellTp1Position - sellTp2Position),
        executionProfile: `SL +${(stopLossPct * 100).toFixed(0)}% | TP1 -${sellTp1Percent}% (${sellTp1Position}% pos.) | TP2 -${sellTp2Percent}% (${sellTp2Position}% pos.) | restante fecho manual`,
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
  const buyTrendMaPeriod = Math.max(2, Number(params.buyTrendMaPeriod) || 30);
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 2);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 2);
  const sellSmoothPrevMin = Number(params.sellSmoothPrevMin ?? 2);
  const sellSmoothCurrMax = Number(params.sellSmoothCurrMax ?? 2);
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
      meanAtClose: meanAtClose.toFixed(8),
      trendMaPeriod: buyTrendMaPeriod,
      trendAtClose: trendAtClose.toFixed(8),
      buySmoothPrevMax,
      buySmoothCurrMin,
      sellSmoothPrevMin,
      sellSmoothCurrMax,
    };

    const sellCrossSmooth2To2 =
      smoothPrev >= sellSmoothPrevMin && smoothCurr <= sellSmoothCurrMax;

    if (
      sideEnabled('SELL', params) &&
      sellCrossSmooth2To2 &&
      currentPrice < meanAtClose &&
      currentPrice < trendAtClose
    ) {
      const stopLoss = currentPrice * 1.04;
      const target1 = currentPrice * 0.8;
      const drop = smoothPrev - smoothCurr;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(drop, 0) * 10, 25)))
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
          ...extraBase,
          setup: 'smooth_cross_2_to_2_below_ma80_ma30_1h',
        }),
      };
    }

    const buyCrossSmooth2To2 =
      smoothPrev <= buySmoothPrevMax && smoothCurr >= buySmoothCurrMin;

    if (
      sideEnabled('BUY', params) &&
      buyCrossSmooth2To2 &&
      currentPrice > meanAtClose &&
      currentPrice > trendAtClose
    ) {
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
          setup: 'smooth_cross_2_to_2_above_ma80_ma30_1h',
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
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 2);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 2);
  const sellSmoothPrevMin = Number(params.sellSmoothPrevMin ?? 2);
  const sellSmoothCurrMax = Number(params.sellSmoothCurrMax ?? 2);
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
      sellSmoothPrevMin,
      sellSmoothCurrMax,
    };

    const sellCrossSmooth2To2 =
      smoothPrev >= sellSmoothPrevMin && smoothCurr <= sellSmoothCurrMax;

    if (
      sideEnabled('SELL', params) &&
      sellCrossSmooth2To2 &&
      currentPrice < meanAtClose &&
      currentPrice < trendAtClose
    ) {
      const stopLoss = currentPrice * (1 + stopLossPct);
      const target1 = currentPrice * (1 - takeProfitPct);
      const drop = smoothPrev - smoothCurr;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(drop, 0) * 10, 25)))
      );

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'smooth_cross_2_to_2_below_ma80_ma30_30m',
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
