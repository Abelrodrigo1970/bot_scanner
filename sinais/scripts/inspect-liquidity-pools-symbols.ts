/**
 * Liquidity Pools 15m — entrada SHORT/LONG por símbolo (pools activos + sinais recentes).
 * Uso: npx tsx scripts/inspect-liquidity-pools-symbols.ts
 */
import { fetchCandles, dropFormingCandle } from '../lib/marketData';
import { detectLiquidityPoolSweep } from '../lib/liquidityPoolDetector';
import { LIQUIDITY_POOLS_PRO_15M_PARAMS } from '../lib/strategyMigrations';
import { calculateATR } from '../lib/indicators';

const SYMBOLS = (process.env.SYMS || 'USELESSUSDT,ONGUSDT,CRVUSDT,AGIUSDT,AGTUSDT').split(',').map((s) => s.trim());
const FROM = process.env.FROM || '2026-08-01';
const fromMs = new Date(FROM).getTime();
const params = { ...LIQUIDITY_POOLS_PRO_15M_PARAMS };

function fmtTs(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
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

function replayPools(candles: ReturnType<typeof dropFormingCandle>) {
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
          pool.levelTop = pool.level + tol / 2;
          pool.levelBot = pool.level - tol / 2;
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
          pool.levelTop = pool.level + tol / 2;
          pool.levelBot = pool.level - tol / 2;
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
      if (wickSweep) pool.state = closeBack ? 2 : 1;
    }
  }

  const atrNow = calculateATR(candles, params.atrPeriod ?? 14) ?? 0;
  return { pools, atrNow, tolNow: atrNow * tolMult };
}

async function resolveSymbol(sym: string): Promise<string | null> {
  const candidates = sym.endsWith('USDT') ? [sym] : [`${sym}USDT`, sym];
  for (const c of candidates) {
    try {
      const raw = await fetchCandles(c, '15m', 50);
      if (raw.length > 0) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function analyzeSymbol(requested: string) {
  const symbol = await resolveSymbol(requested);
  if (!symbol) {
    console.log(`\n${'═'.repeat(72)}\n${requested}: símbolo não encontrado\n`);
    return;
  }

  const raw = await fetchCandles(symbol, '15m', 1500);
  const candles = dropFormingCandle(raw, '15m');
  const last = candles[candles.length - 1]!;

  const recentSignals: Array<{ ts: number; dir: string; entry: number; pool: number; str: number; touches: number }> = [];
  let prevTs: number | null = null;
  for (let i = 80; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const bar = slice[slice.length - 1]!;
    if (bar.timestamp < fromMs) continue;
    const hit = detectLiquidityPoolSweep(slice, params);
    if (!hit || hit.barCloseTs !== bar.timestamp || hit.barCloseTs === prevTs) continue;
    prevTs = hit.barCloseTs;
    recentSignals.push({
      ts: hit.barCloseTs,
      dir: hit.direction,
      entry: hit.entryPrice,
      pool: hit.poolLevel,
      str: hit.strength,
      touches: hit.touchCount,
    });
  }

  const { pools, atrNow, tolNow } = replayPools(candles);
  const active = pools.filter((p) => p.state === 0);
  const ssl = active
    .filter((p) => p.isHigh)
    .sort((a, b) => Math.abs(last.close - a.level) - Math.abs(last.close - b.level));
  const bsl = active
    .filter((p) => !p.isHigh)
    .sort((a, b) => Math.abs(last.close - a.level) - Math.abs(last.close - b.level));

  const lastHit = detectLiquidityPoolSweep(candles, params);

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`${symbol} | vela ${fmtTs(last.timestamp)} | close ${last.close} | ATR ${atrNow.toFixed(6)}`);
  if (lastHit) {
    console.log(`⚡ SINAL NA ÚLTIMA VELA: ${lastHit.direction} @ ${lastHit.entryPrice.toFixed(6)} (str ${lastHit.strength})`);
  }

  console.log('\n── SHORT (SSL sweep + fecho abaixo) ──');
  if (ssl.length === 0) {
    console.log('  Sem pool SSL activo — aguarda formação de highs iguais.');
  } else {
    for (const p of ssl.slice(0, 4)) {
      const sweepAbove = p.level + tolNow / 2;
      const gapHighPct = ((sweepAbove - last.high) / last.high) * 100;
      const closeBelow = p.level;
      const distPct = ((last.close - p.level) / p.level) * 100;
      console.log(
        `  Pool ${p.level.toFixed(6)} (${p.touchCount} touches) | preço ${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}% vs pool`
      );
      console.log(`    Entrada SHORT se: high > ${sweepAbove.toFixed(6)} (${gapHighPct >= 0 ? 'falta +' : ''}${gapHighPct.toFixed(2)}%) + close < ${closeBelow.toFixed(6)}`);
    }
  }

  console.log('\n── LONG (BSL sweep + fecho acima) ──');
  if (bsl.length === 0) {
    console.log('  Sem pool BSL activo — aguarda formação de lows iguais.');
  } else {
    for (const p of bsl.slice(0, 4)) {
      const sweepBelow = p.level - tolNow / 2;
      const gapLowPct = ((last.low - sweepBelow) / last.low) * 100;
      const closeAbove = p.level;
      const distPct = ((last.close - p.level) / p.level) * 100;
      console.log(
        `  Pool ${p.level.toFixed(6)} (${p.touchCount} touches) | preço ${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}% vs pool`
      );
      console.log(`    Entrada LONG se: low < ${sweepBelow.toFixed(6)} (${gapLowPct >= 0 ? 'falta -' : 'já abaixo '}${Math.abs(gapLowPct).toFixed(2)}%) + close > ${closeAbove.toFixed(6)}`);
    }
  }

  const last5 = recentSignals.slice(-5);
  if (last5.length > 0) {
    console.log('\n── Últimos sinais (desde ' + FROM + ') ──');
    for (const s of last5) {
      console.log(`  ${fmtTs(s.ts)} ${s.dir.padEnd(4)} entry ${s.entry.toFixed(6)} pool ${s.pool.toFixed(6)} str ${s.str}`);
    }
    console.log(`  Total período: ${recentSignals.length} sinais`);
  }
}

async function main() {
  console.log('Liquidity Pools 15m — pontos de entrada SHORT/LONG');
  for (const sym of SYMBOLS) {
    await analyzeSymbol(sym);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
