/**
 * Swing Anchored VWAP — lógica inspirada em BigBeluga (Pine v6).
 * length-bar high/low → swing anchor → VWAP em highs/lows desde o pivot.
 * trend=true em novo máximo de length; trend=false em novo mínimo.
 * Sinal: flip de tendência na vela fechada (BUY bullish / SELL bearish).
 */

import type { Candle } from './marketData';

export type SwingAnchoredVwapParams = {
  lookbackLength?: number;
  stopLossPct?: number;
  slSwingBufferPct?: number;
  useSwingLevelSl?: boolean;
  tp1Pct?: number;
  tp1Position?: number;
  closeAfterHours?: number;
};

export type SwingAnchoredVwapHit = {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  activeVwap: number;
  swingLevel: number;
  swingIndex: number;
  trend: boolean;
  strength: number;
  barCloseTs: number;
  extraInfo: string;
};

const DEFAULTS: Required<SwingAnchoredVwapParams> = {
  lookbackLength: 50,
  stopLossPct: 0.05,
  slSwingBufferPct: 0.005,
  useSwingLevelSl: true,
  tp1Pct: 0.1,
  tp1Position: 50,
  closeAfterHours: 24,
};

function resolveParams(p: SwingAnchoredVwapParams): Required<SwingAnchoredVwapParams> {
  return { ...DEFAULTS, ...p };
}

function rollingHighest(candles: Candle[], idx: number, length: number): number {
  const start = Math.max(0, idx - length + 1);
  let max = -Infinity;
  for (let j = start; j <= idx; j++) {
    max = Math.max(max, candles[j]!.high);
  }
  return max;
}

function rollingLowest(candles: Candle[], idx: number, length: number): number {
  const start = Math.max(0, idx - length + 1);
  let min = Infinity;
  for (let j = start; j <= idx; j++) {
    min = Math.min(min, candles[j]!.low);
  }
  return min;
}

/** VWAP de `useHigh` desde anchorIdx até endIdx (inclusive). */
function anchoredVwap(
  candles: Candle[],
  anchorIdx: number,
  endIdx: number,
  useHigh: boolean
): number {
  if (anchorIdx < 0 || endIdx < anchorIdx) return candles[endIdx]?.close ?? 0;
  let sumPV = 0;
  let sumV = 0;
  let sumP = 0;
  let count = 0;
  for (let j = anchorIdx; j <= endIdx; j++) {
    const price = useHigh ? candles[j]!.high : candles[j]!.low;
    const vol = candles[j]!.volume ?? 0;
    sumP += price;
    count++;
    if (vol > 0) {
      sumPV += price * vol;
      sumV += vol;
    }
  }
  if (sumV > 0) return sumPV / sumV;
  return count > 0 ? sumP / count : candles[endIdx]!.close;
}

type ReplayState = {
  trend: boolean;
  highIndex: number;
  highVal: number;
  lowIndex: number;
  lowVal: number;
  hVwap: number;
  lVwap: number;
};

/**
 * Detecta flip de tendência na última vela fechada.
 */
export function detectSwingAnchoredVwapSignal(
  candles: Candle[],
  params: SwingAnchoredVwapParams = {}
): SwingAnchoredVwapHit | null {
  const p = resolveParams(params);
  const length = Math.max(5, Math.floor(p.lookbackLength));
  const warmup = length + 2;
  if (candles.length < warmup) return null;

  let state: ReplayState = {
    trend: false,
    highIndex: 0,
    highVal: candles[0]!.high,
    lowIndex: 0,
    lowVal: candles[0]!.low,
    hVwap: candles[0]!.high,
    lVwap: candles[0]!.low,
  };

  let prevTrend = false;

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;
    const h = rollingHighest(candles, i, length);
    const l = rollingLowest(candles, i, length);

    if (i > 0) {
      const prev = candles[i - 1]!;
      const hPrev = rollingHighest(candles, i - 1, length);
      const lPrev = rollingLowest(candles, i - 1, length);

      if (prev.high === hPrev && bar.high < h) {
        state.highIndex = i - 1;
        state.highVal = prev.high;
        state.hVwap = anchoredVwap(candles, state.highIndex, i, true);
      } else if (state.highIndex >= 0) {
        state.hVwap = anchoredVwap(candles, state.highIndex, i, true);
      }

      if (prev.low === lPrev && bar.low > l) {
        state.lowIndex = i - 1;
        state.lowVal = prev.low;
        state.lVwap = anchoredVwap(candles, state.lowIndex, i, false);
      } else if (state.lowIndex >= 0) {
        state.lVwap = anchoredVwap(candles, state.lowIndex, i, false);
      }
    }

    prevTrend = state.trend;
    if (bar.high === h) state.trend = true;
    if (bar.low === l) state.trend = false;

    const isLast = i === candles.length - 1;
    if (!isLast) continue;

    const flippedBull = state.trend && !prevTrend;
    const flippedBear = !state.trend && prevTrend;
    if (!flippedBull && !flippedBear) return null;

    const direction: 'BUY' | 'SELL' = flippedBull ? 'BUY' : 'SELL';
    const entry = bar.close;
    const activeVwap = state.trend ? state.lVwap : state.hVwap;
    const swingLevel = direction === 'BUY' ? state.lowVal : state.highVal;
    const swingIndex = direction === 'BUY' ? state.lowIndex : state.highIndex;

    let stopLoss: number;
    if (p.useSwingLevelSl && swingLevel > 0) {
      if (direction === 'BUY') {
        stopLoss = swingLevel * (1 - p.slSwingBufferPct);
      } else {
        stopLoss = swingLevel * (1 + p.slSwingBufferPct);
      }
    } else if (direction === 'BUY') {
      stopLoss = entry * (1 - p.stopLossPct);
    } else {
      stopLoss = entry * (1 + p.stopLossPct);
    }

    // SL inválido (swing acima da entrada no short, etc.) → fallback %
    if (direction === 'BUY' && stopLoss >= entry) {
      stopLoss = entry * (1 - p.stopLossPct);
    }
    if (direction === 'SELL' && stopLoss <= entry) {
      stopLoss = entry * (1 + p.stopLossPct);
    }

    let target1: number;
    if (direction === 'BUY' && activeVwap > entry) {
      target1 = activeVwap;
    } else if (direction === 'SELL' && activeVwap < entry) {
      target1 = activeVwap;
    } else if (direction === 'BUY') {
      target1 = entry * (1 + p.tp1Pct);
    } else {
      target1 = entry * (1 - p.tp1Pct);
    }

    const breakPct =
      direction === 'BUY'
        ? ((entry - state.lowVal) / state.lowVal) * 100
        : ((state.highVal - entry) / state.highVal) * 100;
    const strength = Math.min(95, Math.max(55, Math.round(60 + Math.min(25, breakPct * 2))));

    const slLabel = (p.stopLossPct * 100).toFixed(0);
    const tpLabel = (p.tp1Pct * 100).toFixed(0);
    const extraInfo = JSON.stringify({
      setup: 'swing_anchored_vwap_15m',
      lookbackLength: length,
      trend: state.trend,
      activeVwap,
      swingLevel,
      swingIndex,
      hVwap: state.hVwap,
      lVwap: state.lVwap,
      highVal: state.highVal,
      lowVal: state.lowVal,
      breakPct: +breakPct.toFixed(2),
      stopLossPct: p.stopLossPct,
      tp1Pct: p.tp1Pct,
      tp1Position: p.tp1Position,
      closeAfterHours: p.closeAfterHours,
      barCloseTs: bar.timestamp,
      executionProfile: `${direction} | Swing Anchored VWAP ${length} | novo ${length}bar ${direction === 'BUY' ? 'high' : 'low'} | SL swing/${slLabel}% | TP1 VWAP ou ${tpLabel}% (${p.tp1Position}%) | resto ${p.closeAfterHours}h`,
    });

    return {
      direction,
      entryPrice: entry,
      stopLoss,
      target1,
      activeVwap,
      swingLevel,
      swingIndex,
      trend: state.trend,
      strength,
      barCloseTs: bar.timestamp,
      extraInfo,
    };
  }

  return null;
}
