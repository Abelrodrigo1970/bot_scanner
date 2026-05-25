/**
 * Estratégias importadas de crypto-sinais-automaticos (MACD+PMO, afastamento, RSI queda 70).
 */

import { dropFormingCandle, fetchCandles, type Timeframe } from './marketData';
import {
  calculateMACD,
  calculatePMO,
  calculateRSI,
  calculateRSISeries,
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

/** Força Afastamento: 65 + 10×salto smooth (mín. 60, máx. 90). */
function afastamentoStrengthFromSmoothJump(jump: number): number {
  return Math.min(
    100,
    Math.max(60, Math.round(65 + Math.min(Math.max(jump, 0) * 10, 25)))
  );
}

/** Bloqueia sinais com força acima do tecto (0 = desactiva). Default 75. */
function afastamentoStrengthAllowed(strength: number, params: StrategyParams): boolean {
  const maxStrength = Number(params.maxStrength ?? 75);
  if (!Number.isFinite(maxStrength) || maxStrength <= 0) return true;
  return strength <= maxStrength;
}

function emaValueAtClosedIdx(emaSeries: number[], period: number, closedIdx: number): number | null {
  const off = period - 1;
  const j = closedIdx - off;
  if (j < 0 || j >= emaSeries.length) return null;
  return emaSeries[j];
}

function rsiAtClosedIdx(rsiSeries: number[], rsiPeriod: number, closedIdx: number): number | null {
  const j = closedIdx - rsiPeriod;
  if (j < 0 || j >= rsiSeries.length) return null;
  const v = rsiSeries[j];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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

export async function runRsiOverboughtDropLegacy1hStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const rsiPeriod = Math.max(2, Number(params.rsiPeriod) || 14);
  const overboughtLevel = Number(params.overboughtLevel ?? 70);
  const minDropPoints = Math.max(1, Number(params.minDropPoints) || 4);
  const minDistancePct = Number(params.minDistancePct ?? 10);
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
    const closedCandles = dropFormingCandle(candles, timeframe);
    if (closedCandles.length < Math.max(maPeriod, rsiPeriod) + 5) return null;

    const closes = getCloses(closedCandles);
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

    const currentPrice = closedCandles[closedCandles.length - 1]!.close;
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
    console.error(`Erro RSI queda 70 legado ${symbol}:`, error);
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
  const overboughtLevel = Number(params.overboughtLevel ?? 55);
  const minDropPoints = Math.max(1, Number(params.minDropPoints) || 3);
  const rsiPullbackLookback = Math.max(3, Number(params.rsiPullbackLookback) || 10);
  const rsiPullbackMinPeak = Number(params.rsiPullbackMinPeak ?? 50);
  const emaFast = Math.max(2, Math.floor(Number(params.emaFastPeriod ?? 12)));
  const emaMid = Math.max(emaFast + 1, Math.floor(Number(params.emaMidPeriod ?? 30)));
  const emaSlow = Math.max(emaMid + 1, Math.floor(Number(params.emaSlowPeriod ?? 80)));
  const emaTrend = Math.max(emaSlow + 1, Math.floor(Number(params.emaTrendPeriod ?? 200)));
  const pullbackMaxBars = Math.max(3, Math.floor(Number(params.pullbackMaxBars) || 8));
  const maxDistBelowEma80Pct = Number(params.maxDistBelowEma80Pct ?? 10);
  const slopeLookback = Math.max(2, Math.floor(Number(params.slopeLookback) || 8));
  const minEma200SlopeDownPct = Number(params.minEma200SlopeDownPct ?? 0.1);
  const requireBearStack = paramFlag(params.requireBearStack, true);
  const requireBearCandle = paramFlag(params.requireBearCandle, true);
  const stopLossPct = Number(params.stopLossPct ?? 0.08);
  const sellTp1Percent = Number(params.sellTp1Percent ?? 9);
  const sellTp2Percent = Number(params.sellTp2Percent ?? 19);
  const sellTp1Position = Math.min(100, Math.max(1, Number(params.sellTp1Position ?? 30)));
  const sellTp2Position = Math.min(100, Math.max(1, Number(params.sellTp2Position ?? 40)));

  try {
    const historyBars = Math.max(pullbackMaxBars, rsiPullbackLookback, slopeLookback) + 5;
    const warm = emaTrend + historyBars + rsiPeriod + 20;
    const candlesNeeded = Math.min(1500, Math.max(260, warm));
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < emaTrend + historyBars + 5) return null;

    const closedCandles = candles.slice(0, -1);
    const lc = closedCandles.length - 1;
    if (lc < emaTrend + historyBars) return null;

    const closedCloses = closedCandles.map((c) => c.close);
    const ema12Series = calculateEMA(closedCloses, emaFast);
    const ema30Series = calculateEMA(closedCloses, emaMid);
    const ema80Series = calculateEMA(closedCloses, emaSlow);
    const ema200Series = calculateEMA(closedCloses, emaTrend);
    if (!ema12Series || !ema30Series || !ema80Series || !ema200Series) return null;

    const e12 = emaValueAtClosedIdx(ema12Series, emaFast, lc);
    const e30 = emaValueAtClosedIdx(ema30Series, emaMid, lc);
    const e80 = emaValueAtClosedIdx(ema80Series, emaSlow, lc);
    const e200 = emaValueAtClosedIdx(ema200Series, emaTrend, lc);
    if (e12 == null || e30 == null || e80 == null || e200 == null || e80 === 0) return null;

    const c = closedCandles[lc];
    const currentPrice = c.close;

    if (requireBearStack && !(e200 > e80 && e80 > e30 && e30 > e12)) return null;
    if (!(currentPrice < e80)) return null;

    if (maxDistBelowEma80Pct > 0) {
      const distBelowEma80Pct = ((e80 - currentPrice) / e80) * 100;
      if (distBelowEma80Pct > maxDistBelowEma80Pct) return null;
    }

    const e200Then = emaValueAtClosedIdx(ema200Series, emaTrend, lc - slopeLookback);
    if (e200Then == null || e200Then === 0) return null;
    const ema200SlopePct = ((e200 - e200Then) / e200Then) * 100;
    if (minEma200SlopeDownPct > 0 && ema200SlopePct > -minEma200SlopeDownPct) return null;

    let hadPullback = false;
    const pbFrom = Math.max(emaTrend - 1, lc - pullbackMaxBars);
    for (let j = pbFrom; j <= lc - 1; j++) {
      const j30 = emaValueAtClosedIdx(ema30Series, emaMid, j);
      if (j30 == null) continue;
      const bar = closedCandles[j];
      if (bar.high >= j30 * (1 - 0.002)) {
        hadPullback = true;
        break;
      }
    }
    if (!hadPullback) return null;

    const rsiSeries = calculateRSISeries(closedCloses, rsiPeriod);
    if (rsiSeries.length < rsiPeriod + 3) return null;

    const rsiCurr = rsiAtClosedIdx(rsiSeries, rsiPeriod, lc);
    const rsiPrev = rsiAtClosedIdx(rsiSeries, rsiPeriod, lc - 1);
    if (rsiCurr == null || rsiPrev == null) return null;

    const drop = rsiPrev - rsiCurr;
    if (!(drop >= minDropPoints && rsiPrev >= overboughtLevel && rsiCurr < rsiPrev)) return null;

    let rsiPeak = rsiPrev;
    const peakFrom = Math.max(rsiPeriod, lc - rsiPullbackLookback);
    for (let j = peakFrom; j <= lc; j++) {
      const r = rsiAtClosedIdx(rsiSeries, rsiPeriod, j);
      if (r != null) rsiPeak = Math.max(rsiPeak, r);
    }
    if (rsiPeak < rsiPullbackMinPeak) return null;

    if (requireBearCandle && c.close >= c.open) return null;
    if (!(c.close < e12)) return null;

    const stopLoss = currentPrice * (1 + stopLossPct);
    const target1 = currentPrice * (1 - sellTp1Percent / 100);
    const target2 = currentPrice * (1 - sellTp2Percent / 100);

    const distBelowEma80Pct = ((e80 - currentPrice) / e80) * 100;
    const slopeStrength = Math.min(12, Math.max(0, -ema200SlopePct - minEma200SlopeDownPct) * 3);
    const rsiStrength = Math.min(14, Math.max(0, drop - minDropPoints) * 2.5);
    const peakStrength = Math.min(8, Math.max(0, rsiPeak - rsiPullbackMinPeak) * 0.4);
    const strength = Math.min(
      98,
      Math.max(
        65,
        Math.round(65 + slopeStrength + rsiStrength + peakStrength + Math.min(distBelowEma80Pct, 6))
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
        setup: 'rsi_pullback_bear_breakdown',
        rsiPeriod,
        overboughtLevel,
        minDropPoints,
        rsiPullbackMinPeak,
        rsiPrev: rsiPrev.toFixed(2),
        rsiCurr: rsiCurr.toFixed(2),
        rsiPeak: rsiPeak.toFixed(2),
        drop: drop.toFixed(2),
        distBelowEma80Pct: distBelowEma80Pct.toFixed(3),
        ema200SlopePct: ema200SlopePct.toFixed(3),
        emaStack: { ema12: e12, ema30: e30, ema80: e80, ema200: e200 },
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
    console.error(`Erro RSI pullback bear 1h ${symbol}:`, error);
    return null;
  }
}

function afastamentoExitLevels(
  currentPrice: number,
  direction: 'BUY' | 'SELL',
  params: StrategyParams,
  defaults: {
    stopLossPct: number;
    tp1Pct: number;
    tp1Position: number;
    closeAfterHours: number;
  }
): {
  stopLoss: number;
  target1: number;
  extraExit: Record<string, unknown>;
} {
  const stopLossPct = Number(params.stopLossPct ?? defaults.stopLossPct);
  const tp1Pct = Number(params.tp1Pct ?? defaults.tp1Pct);
  const tp1Position = Number(params.tp1Position ?? defaults.tp1Position);
  const closeAfterHours = Number(params.closeAfterHours ?? defaults.closeAfterHours);
  const stopLoss =
    direction === 'BUY'
      ? currentPrice * (1 - stopLossPct)
      : currentPrice * (1 + stopLossPct);
  const target1 =
    direction === 'BUY'
      ? currentPrice * (1 + tp1Pct)
      : currentPrice * (1 - tp1Pct);
  const slLabel = `${(stopLossPct * 100).toFixed(0)}%`;
  const tpLabel = `${(tp1Pct * 100).toFixed(0)}%`;
  return {
    stopLoss,
    target1,
    extraExit: {
      stopLossPct,
      tp1Pct,
      tp1Position,
      closeAfterHours,
      tp1Percent: tp1Pct * 100,
      executionProfile:
        direction === 'BUY'
          ? `SL -${slLabel} | TP1 +${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`
          : `SL +${slLabel} | TP1 -${tpLabel} (${tp1Position}% pos.) | restante às ${closeAfterHours}h`,
    },
  };
}

const AFASTAMENTO_1H_EXIT_DEFAULTS = {
  stopLossPct: 0.04,
  tp1Pct: 0.09,
  tp1Position: 40,
  closeAfterHours: 24,
} as const;

const AFASTAMENTO_30M_EXIT_DEFAULTS = {
  stopLossPct: 0.06,
  tp1Pct: 0.09,
  tp1Position: 50,
  closeAfterHours: 24,
} as const;

function afastamento1hExitLevels(
  currentPrice: number,
  direction: 'BUY' | 'SELL',
  params: StrategyParams
) {
  return afastamentoExitLevels(currentPrice, direction, params, AFASTAMENTO_1H_EXIT_DEFAULTS);
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
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 1.9);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 2.4);
  const sellSmoothPrevMin = Number(params.sellSmoothPrevMin ?? 2.4);
  const sellSmoothCurrMax = Number(params.sellSmoothCurrMax ?? 1.9);
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
      const { stopLoss, target1, extraExit } = afastamento1hExitLevels(
        currentPrice,
        'SELL',
        params
      );
      const drop = smoothPrev - smoothCurr;
      const strength = afastamentoStrengthFromSmoothJump(drop);
      if (!afastamentoStrengthAllowed(strength, params)) return null;

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          ...extraExit,
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
      const { stopLoss, target1, extraExit } = afastamento1hExitLevels(
        currentPrice,
        'BUY',
        params
      );
      const rise = smoothCurr - smoothPrev;
      const strength = afastamentoStrengthFromSmoothJump(rise);
      if (!afastamentoStrengthAllowed(strength, params)) return null;

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          ...extraExit,
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
  if (direction === 'BUY') return params.buyEnabled !== false;
  return params.sellEnabled !== false;
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
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 2.3);
  const sellSmoothPrevMin = Number(params.sellSmoothPrevMin ?? 2.3);
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
      const { stopLoss, target1, extraExit } = afastamentoExitLevels(
        currentPrice,
        'SELL',
        params,
        AFASTAMENTO_30M_EXIT_DEFAULTS
      );
      const drop = smoothPrev - smoothCurr;
      const strength = afastamentoStrengthFromSmoothJump(drop);
      if (!afastamentoStrengthAllowed(strength, params)) return null;

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          ...extraExit,
          setup: 'smooth_cross_2_to_2_below_ma80_ma30_30m',
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
      const { stopLoss, target1, extraExit } = afastamentoExitLevels(
        currentPrice,
        'BUY',
        params,
        AFASTAMENTO_30M_EXIT_DEFAULTS
      );
      const rise = smoothCurr - smoothPrev;
      const strength = afastamentoStrengthFromSmoothJump(rise);
      if (!afastamentoStrengthAllowed(strength, params)) return null;

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          ...extraExit,
          setup: 'smooth_cross_2_to_2_above_ma80_ma30_30m',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro Afastamento Médio 30m ${symbol}:`, error);
    return null;
  }
}
