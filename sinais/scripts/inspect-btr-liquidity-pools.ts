/**
 * BTRUSDT — sinais Liquidity Pools 15m + estado actual dos pools.
 */
import { fetchCandles, dropFormingCandle } from '../lib/marketData';
import { detectLiquidityPoolSweep } from '../lib/liquidityPoolDetector';
import { LIQUIDITY_POOLS_PRO_15M_PARAMS } from '../lib/strategyMigrations';
import { calculateATR } from '../lib/indicators';

const SYMBOL = 'BTRUSDT';
const FROM = process.env.FROM || '2026-08-01';
const fromMs = new Date(FROM).getTime();

const params = { ...LIQUIDITY_POOLS_PRO_15M_PARAMS };

function fmtTs(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function simulate(hit: NonNullable<ReturnType<typeof detectLiquidityPoolSweep>>) {
  const entry = hit.entryPrice;
  const sign = hit.direction === 'BUY' ? 1 : -1;
  const tp1Pct = sign * ((hit.target1 - entry) / entry) * 100;
  const tp2Pct = sign * ((hit.target2 - entry) / entry) * 100;
  const tp3Pct = sign * ((hit.target3 - entry) / entry) * 100;
  const p1 = params.tp1Position / 100;
  const p2 = params.tp2Position / 100;
  const p3 = 1 - p1 - p2;
  return p1 * tp1Pct + p2 * tp2Pct + p3 * tp3Pct;
}

type Pool = {
  level: number;
  touchCount: number;
  lastTouchIdx: number;
  isHigh: boolean;
  state: number;
  levelTop: number;
  levelBot: number;
};

async function main() {
  const raw = await fetchCandles(SYMBOL, '15m', 1500);
  const candles = dropFormingCandle(raw, '15m');
  const last = candles[candles.length - 1]!;

  console.log(`\n${SYMBOL} Liquidity Pools 15m | última vela fechada: ${fmtTs(last.timestamp)}`);
  console.log(`Close: ${last.close} | High: ${last.high} | Low: ${last.low}\n`);

  const signals: Array<{ bar: typeof last; hit: NonNullable<ReturnType<typeof detectLiquidityPoolSweep>> }> = [];
  let prevTs: number | null = null;
  for (let i = 80; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const bar = slice[slice.length - 1]!;
    if (bar.timestamp < fromMs) continue;
    const hit = detectLiquidityPoolSweep(slice, params);
    if (!hit || hit.barCloseTs !== bar.timestamp) continue;
    if (hit.barCloseTs === prevTs) continue;
    prevTs = hit.barCloseTs;
    signals.push({ bar, hit });
  }

  console.log(`═══ SINAIS desde ${FROM} (${signals.length}) ═══`);
  for (const { hit } of signals) {
    const net = simulate(hit);
    const poolType = hit.isHighPool ? 'SSL(high)' : 'BSL(low)';
    console.log(
      `${fmtTs(hit.barCloseTs)} | ${hit.direction.padEnd(4)} | entry ${hit.entryPrice.toFixed(5)} | pool ${hit.poolLevel.toFixed(5)} (${poolType}) | str ${hit.strength} touches ${hit.touchCount} | sim ${net >= 0 ? '+' : ''}${net.toFixed(2)}%`
    );
  }

  const left = params.pivotLeft ?? 8;
  const right = params.pivotRight ?? 2;
  const warmup = Math.max(50, (params.atrLenRisk ?? 14) + left + right + 5);
  const POOL_ACTIVE = 0;
  const pools: Pool[] = [];
  const tolMult = params.atrToleranceMult ?? 0.25;

  function findPool(price: number, isHigh: boolean, tol: number, barIdx: number) {
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i]!;
      if (p.state !== POOL_ACTIVE || p.isHigh !== isHigh) continue;
      if (Math.abs(price - p.level) <= tol && barIdx - p.lastTouchIdx <= (params.maxLookback ?? 200))
        return i;
    }
    return -1;
  }

  function isPivotHigh(c: typeof candles, idx: number) {
    if (idx < left || idx + right >= c.length) return false;
    const h = c[idx]!.high;
    for (let j = idx - left; j <= idx + right; j++) {
      if (j === idx) continue;
      if (c[j]!.high >= h) return false;
    }
    return true;
  }

  function isPivotLow(c: typeof candles, idx: number) {
    if (idx < left || idx + right >= c.length) return false;
    const l = c[idx]!.low;
    for (let j = idx - left; j <= idx + right; j++) {
      if (j === idx) continue;
      if (c[j]!.low <= l) return false;
    }
    return true;
  }

  for (let i = warmup; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const atr = calculateATR(slice, params.atrPeriod ?? 14) ?? 0;
    if (atr <= 0) continue;
    const tol = atr * tolMult;
    const bar = candles[i]!;
    const pivotIdx = i - right;
    if (pivotIdx >= left) {
      if (isPivotHigh(candles, pivotIdx)) {
        const ph = candles[pivotIdx]!.high;
        const m = findPool(ph, true, tol, pivotIdx);
        if (m >= 0) {
          const pool = pools[m]!;
          pool.level = (pool.level * pool.touchCount + ph) / (pool.touchCount + 1);
          pool.touchCount++;
          pool.lastTouchIdx = pivotIdx;
        } else
          pools.push({
            level: ph,
            touchCount: 1,
            lastTouchIdx: pivotIdx,
            isHigh: true,
            state: POOL_ACTIVE,
            levelTop: ph + tol / 2,
            levelBot: ph - tol / 2,
          });
      }
      if (isPivotLow(candles, pivotIdx)) {
        const pl = candles[pivotIdx]!.low;
        const m = findPool(pl, false, tol, pivotIdx);
        if (m >= 0) {
          const pool = pools[m]!;
          pool.level = (pool.level * pool.touchCount + pl) / (pool.touchCount + 1);
          pool.touchCount++;
          pool.lastTouchIdx = pivotIdx;
        } else
          pools.push({
            level: pl,
            touchCount: 1,
            lastTouchIdx: pivotIdx,
            isHigh: false,
            state: POOL_ACTIVE,
            levelTop: pl + tol / 2,
            levelBot: pl - tol / 2,
          });
      }
    }
    for (const pool of pools) {
      if (pool.state !== POOL_ACTIVE || i < pool.lastTouchIdx + right + 1) continue;
      const wickSweep = pool.isHigh ? bar.high > pool.levelTop : bar.low < pool.levelBot;
      const closeBack = pool.isHigh ? bar.close < pool.level : bar.close > pool.level;
      if (wickSweep) {
        pool.state = closeBack ? 2 : 1;
      }
    }
  }

  const atrNow = calculateATR(candles, params.atrPeriod ?? 14) ?? 0;
  const tolNow = atrNow * tolMult;
  const active = pools.filter((p) => p.state === POOL_ACTIVE);

  console.log(`\n═══ POOLS ACTIVOS agora (ATR=${atrNow.toFixed(5)} tol=${tolNow.toFixed(5)}) ═══`);
  const sorted = [...active].sort((a, b) => {
    const da = Math.abs(last.close - a.level);
    const db = Math.abs(last.close - b.level);
    return da - db;
  });

  for (const p of sorted.slice(0, 8)) {
    const type = p.isHigh ? 'SSL → SELL se sweep+mitigate' : 'BSL → BUY se sweep+mitigate';
    const distPct = ((last.close - p.level) / p.level) * 100;
    const levelTop = p.level + tolNow / 2;
    const levelBot = p.level - tolNow / 2;
    const needSweep = p.isHigh
      ? `wick high > ${levelTop.toFixed(5)} (falta ${((levelTop - last.high) / last.high * 100).toFixed(2)}% no high)`
      : `wick low < ${levelBot.toFixed(5)} (falta ${((last.low - levelBot) / last.low * 100).toFixed(2)}% no low)`;
    const needClose = p.isHigh ? `fecho < ${p.level.toFixed(5)}` : `fecho > ${p.level.toFixed(5)}`;
    console.log(
      `  ${type} | nível ${p.level.toFixed(5)} | touches ${p.touchCount} | preço ${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}% do nível`
    );
    console.log(`    Para sinal: ${needSweep} + ${needClose} na mesma vela 15m`);
  }

  if (active.length === 0) console.log('  (sem pools activos — aguarda formação de pivots iguais)');

  const nextHit = detectLiquidityPoolSweep(candles, params);
  console.log(`\n═══ ÚLTIMA VELA FECHADA ═══`);
  if (nextHit) {
    console.log(`  SINAL JÁ DISPAROU: ${nextHit.direction} str=${nextHit.strength} pool=${nextHit.poolLevel.toFixed(5)}`);
  } else {
    console.log('  Sem sinal na última vela fechada.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
