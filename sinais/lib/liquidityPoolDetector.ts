/**
 * Liquidity pool detection + sweep/mitigation signals (SMC-style).
 * Inspired by equal-high/low pivot clustering with ATR tolerance.
 */

import type { Candle } from './marketData';
import { calculateATR } from './indicators';

export const POOL_STATE_ACTIVE = 0;
export const POOL_STATE_SWEPT = 1;
export const POOL_STATE_MITIGATED = 2;

export type LiquidityPoolDetectorParams = {
  pivotLeft?: number;
  pivotRight?: number;
  atrToleranceMult?: number;
  atrPeriod?: number;
  atrLenRisk?: number;
  maxLookback?: number;
  maxActivePools?: number;
  halfLifeBars?: number;
  minStrengthSignal?: number;
  requireBodyReversal?: boolean;
  useVolumeWeight?: boolean;
  slAtrMult?: number;
  tp1RMult?: number;
  tp2RMult?: number;
  tp3RMult?: number;
  tp1Position?: number;
  tp2Position?: number;
  closeAfterHours?: number;
};

type InternalPool = {
  level: number;
  levelTop: number;
  levelBot: number;
  lastTouchIdx: number;
  touchCount: number;
  cumulativeVol: number;
  isHigh: boolean;
  state: number;
  sweptAtIdx: number;
  htfBonus: number;
};

export type LiquiditySweepHit = {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  strength: number;
  poolLevel: number;
  touchCount: number;
  isHighPool: boolean;
  barCloseTs: number;
  extraInfo: string;
};

const DEFAULTS: Required<LiquidityPoolDetectorParams> = {
  pivotLeft: 8,
  pivotRight: 2,
  atrToleranceMult: 0.25,
  atrPeriod: 14,
  atrLenRisk: 14,
  maxLookback: 200,
  maxActivePools: 40,
  halfLifeBars: 150,
  minStrengthSignal: 25,
  requireBodyReversal: true,
  useVolumeWeight: true,
  slAtrMult: 1.5,
  tp1RMult: 1.0,
  tp2RMult: 2.0,
  tp3RMult: 3.0,
  tp1Position: 33,
  tp2Position: 33,
  closeAfterHours: 24,
};

function resolveParams(p: LiquidityPoolDetectorParams): Required<LiquidityPoolDetectorParams> {
  return { ...DEFAULTS, ...p };
}

function isPivotHigh(candles: Candle[], idx: number, left: number, right: number): boolean {
  if (idx < left || idx + right >= candles.length) return false;
  const h = candles[idx].high;
  for (let j = idx - left; j <= idx + right; j++) {
    if (j === idx) continue;
    if (candles[j].high >= h) return false;
  }
  return true;
}

function isPivotLow(candles: Candle[], idx: number, left: number, right: number): boolean {
  if (idx < left || idx + right >= candles.length) return false;
  const l = candles[idx].low;
  for (let j = idx - left; j <= idx + right; j++) {
    if (j === idx) continue;
    if (candles[j].low <= l) return false;
  }
  return true;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function computeStrength(
  pool: InternalPool,
  barIdx: number,
  halfLife: number,
  volMedian: number,
  useVolume: boolean
): number {
  const ageBars = barIdx - pool.lastTouchIdx;
  const decay = Math.pow(0.5, ageBars / halfLife);
  const touchPts = Math.min(35, (pool.touchCount - 1) * 9);
  const recencyPts = 35 * decay;
  let volPts = 0;
  if (useVolume && volMedian > 0) {
    const r = pool.cumulativeVol / volMedian;
    volPts = Math.min(20, Math.log(Math.max(1, r)) * 8);
  }
  return Math.max(0, Math.min(100, touchPts + recencyPts + volPts + pool.htfBonus));
}

function findMatchingPool(
  pools: InternalPool[],
  price: number,
  isHigh: boolean,
  tol: number,
  barIdx: number,
  maxLookback: number
): number {
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    if (p.state !== POOL_STATE_ACTIVE || p.isHigh !== isHigh) continue;
    if (Math.abs(price - p.level) <= tol && barIdx - p.lastTouchIdx <= maxLookback) return i;
  }
  return -1;
}

function updatePoolTouch(pool: InternalPool, touchPrice: number, touchIdx: number, touchVol: number, tol: number) {
  const newLevel = (pool.level * pool.touchCount + touchPrice) / (pool.touchCount + 1);
  pool.level = newLevel;
  pool.levelTop = newLevel + tol / 2;
  pool.levelBot = newLevel - tol / 2;
  pool.lastTouchIdx = touchIdx;
  pool.touchCount += 1;
  pool.cumulativeVol += touchVol;
}

function createPool(
  pools: InternalPool[],
  price: number,
  idx: number,
  vol: number,
  isHigh: boolean,
  tol: number
) {
  pools.push({
    level: price,
    levelTop: price + tol / 2,
    levelBot: price - tol / 2,
    lastTouchIdx: idx,
    touchCount: 1,
    cumulativeVol: vol,
    isHigh,
    state: POOL_STATE_ACTIVE,
    sweptAtIdx: 0,
    htfBonus: 0,
  });
}

function prunePools(pools: InternalPool[], maxActive: number, strengthAt: (p: InternalPool, idx: number) => number, barIdx: number) {
  if (pools.length <= maxActive) return;
  let oldestSwept = -1;
  let oldestSweptBar = barIdx + 1;
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    if (p.state !== POOL_STATE_ACTIVE && p.sweptAtIdx < oldestSweptBar) {
      oldestSweptBar = p.sweptAtIdx;
      oldestSwept = i;
    }
  }
  if (oldestSwept >= 0) {
    pools.splice(oldestSwept, 1);
    return;
  }
  let worstIdx = -1;
  let worstStr = 1e9;
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    if (p.state === POOL_STATE_ACTIVE) {
      const s = strengthAt(p, barIdx);
      if (s < worstStr) {
        worstStr = s;
        worstIdx = i;
      }
    }
  }
  if (worstIdx >= 0) pools.splice(worstIdx, 1);
}

/**
 * Detect liquidity sweep on the last closed candle.
 * Returns null if no signal on the final bar.
 */
export function detectLiquidityPoolSweep(
  candles: Candle[],
  params: LiquidityPoolDetectorParams = {}
): LiquiditySweepHit | null {
  const p = resolveParams(params);
  const left = p.pivotLeft;
  const right = p.pivotRight;
  const warmup = Math.max(50, p.atrLenRisk + left + right + 5);
  if (candles.length < warmup + right + 1) return null;

  const pools: InternalPool[] = [];
  let sweepHit: LiquiditySweepHit | null = null;

  const strengthAt = (pool: InternalPool, barIdx: number) => {
    const vols = pools.filter((x) => x.state === POOL_STATE_ACTIVE).map((x) => x.cumulativeVol);
    const volMed = vols.length >= 3 ? median(vols) : 0;
    return computeStrength(pool, barIdx, p.halfLifeBars, volMed, p.useVolumeWeight);
  };

  for (let i = warmup; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const atr = calculateATR(slice, p.atrPeriod) ?? 0;
    if (atr <= 0) continue;
    const tol = atr * p.atrToleranceMult;
    const bar = candles[i];
    const barVol = bar.volume ?? 0;

    const pivotIdx = i - right;
    if (pivotIdx >= left) {
      if (isPivotHigh(candles, pivotIdx, left, right)) {
        const ph = candles[pivotIdx].high;
        const pVol = candles[pivotIdx].volume ?? 0;
        const match = findMatchingPool(pools, ph, true, tol, pivotIdx, p.maxLookback);
        if (match >= 0) updatePoolTouch(pools[match], ph, pivotIdx, pVol, tol);
        else createPool(pools, ph, pivotIdx, pVol, true, tol);
      }
      if (isPivotLow(candles, pivotIdx, left, right)) {
        const pl = candles[pivotIdx].low;
        const pVol = candles[pivotIdx].volume ?? 0;
        const match = findMatchingPool(pools, pl, false, tol, pivotIdx, p.maxLookback);
        if (match >= 0) updatePoolTouch(pools[match], pl, pivotIdx, pVol, tol);
        else createPool(pools, pl, pivotIdx, pVol, false, tol);
      }
    }

    if (p.useVolumeWeight && barVol > 0) {
      for (const pool of pools) {
        if (pool.state !== POOL_STATE_ACTIVE) continue;
        const touched =
          (bar.high >= pool.levelBot && bar.high <= pool.levelTop) ||
          (bar.low >= pool.levelBot && bar.low <= pool.levelTop) ||
          (bar.low <= pool.levelBot && bar.high >= pool.levelTop);
        if (touched && i > pool.lastTouchIdx) pool.cumulativeVol += barVol;
      }
    }

    const vols = pools.map((x) => x.cumulativeVol);
    const volMedian = vols.length >= 3 ? median(vols) : 0;
    const isLastBar = i === candles.length - 1;

    for (const pool of pools) {
      if (pool.state !== POOL_STATE_ACTIVE || i < pool.lastTouchIdx + right + 1) continue;

      const strength = computeStrength(pool, i, p.halfLifeBars, volMedian, p.useVolumeWeight);
      const wickSweep = pool.isHigh ? bar.high > pool.levelTop : bar.low < pool.levelBot;
      const closeBack = pool.isHigh ? bar.close < pool.level : bar.close > pool.level;

      if (wickSweep) {
        if (closeBack) {
          pool.state = POOL_STATE_MITIGATED;
          pool.sweptAtIdx = i;
        } else {
          pool.state = POOL_STATE_SWEPT;
          pool.sweptAtIdx = i;
        }

        const signalEligible = p.requireBodyReversal ? closeBack : true;
        if (
          isLastBar &&
          signalEligible &&
          strength >= p.minStrengthSignal &&
          !sweepHit
        ) {
          const riskAtr = calculateATR(slice, p.atrLenRisk) ?? atr;
          const slDist = riskAtr * p.slAtrMult;
          const entry = bar.close;
          const sign = pool.isHigh ? -1 : 1;
          const stopLoss = entry - sign * slDist;
          const target1 = entry + sign * slDist * p.tp1RMult;
          const target2 = entry + sign * slDist * p.tp2RMult;
          const target3 = entry + sign * slDist * p.tp3RMult;
          const direction = pool.isHigh ? 'SELL' : 'BUY';
          const slLabel = p.slAtrMult.toFixed(1);
          const extraInfo = JSON.stringify({
            poolLevel: pool.level,
            touchCount: pool.touchCount,
            poolStrength: strength,
            isHighPool: pool.isHigh,
            mitigation: closeBack,
            slAtrMult: p.slAtrMult,
            tp1RMult: p.tp1RMult,
            tp2RMult: p.tp2RMult,
            tp3RMult: p.tp3RMult,
            tp1Position: p.tp1Position,
            tp2Position: p.tp2Position,
            closeAfterHours: p.closeAfterHours,
            barCloseTs: bar.timestamp,
            executionProfile: `${direction} | Liquidity sweep 15m (pool ${pool.isHigh ? 'SSL' : 'BSL'} mitigated) | SL ${slLabel}×ATR | TP ${p.tp1RMult}R/${p.tp2RMult}R/${p.tp3RMult}R`,
          });

          sweepHit = {
            direction,
            entryPrice: entry,
            stopLoss,
            target1,
            target2,
            target3,
            strength: Math.round(strength),
            poolLevel: pool.level,
            touchCount: pool.touchCount,
            isHighPool: pool.isHigh,
            barCloseTs: bar.timestamp,
            extraInfo,
          };
        }
      }
    }

    prunePools(pools, p.maxActivePools, strengthAt, i);
  }

  return sweepHit;
}
