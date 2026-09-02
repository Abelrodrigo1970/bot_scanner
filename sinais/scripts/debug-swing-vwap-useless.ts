/**
 * Replay Swing VWAP on USELESS — compare trend-flip vs hVwap (blue) cross.
 */
import { fetchCandles, dropFormingCandle } from '../lib/marketData';
import { detectSwingAnchoredVwapSignal } from '../lib/swingAnchoredVwapDetector';

function rollingHighest(candles: { high: number }[], idx: number, length: number): number {
  const start = Math.max(0, idx - length + 1);
  let max = -Infinity;
  for (let j = start; j <= idx; j++) max = Math.max(max, candles[j]!.high);
  return max;
}
function rollingLowest(candles: { low: number }[], idx: number, length: number): number {
  const start = Math.max(0, idx - length + 1);
  let min = Infinity;
  for (let j = start; j <= idx; j++) min = Math.min(min, candles[j]!.low);
  return min;
}
function anchoredVwap(
  candles: { high: number; low: number; close: number; volume?: number }[],
  anchorIdx: number,
  endIdx: number,
  useHigh: boolean
): number {
  let sumPV = 0,
    sumV = 0,
    sumP = 0,
    count = 0;
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
  return sumV > 0 ? sumPV / sumV : count > 0 ? sumP / count : candles[endIdx]!.close;
}

async function main() {
  const raw = await fetchCandles('USELESSUSDT', '15m', 400);
  const candles = dropFormingCandle(raw, '15m');
  const length = 50;
  let trend = false;
  let highIndex = 0;
  let highVal = candles[0]!.high;
  let lowIndex = 0;
  let lowVal = candles[0]!.low;
  let hVwap = candles[0]!.high;
  let lVwap = candles[0]!.low;
  const crosses: Array<Record<string, unknown>> = [];
  const flips: Array<Record<string, unknown>> = [];

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;
    const h = rollingHighest(candles, i, length);
    const l = rollingLowest(candles, i, length);
    let hVwapPrev = hVwap;
    if (i > 0) {
      const prev = candles[i - 1]!;
      const hPrev = rollingHighest(candles, i - 1, length);
      const lPrev = rollingLowest(candles, i - 1, length);
      if (prev.high === hPrev && bar.high < h) {
        highIndex = i - 1;
        highVal = prev.high;
      }
      if (prev.low === lPrev && bar.low > l) {
        lowIndex = i - 1;
        lowVal = prev.low;
      }
      hVwapPrev = anchoredVwap(candles, highIndex, i - 1, true);
      hVwap = anchoredVwap(candles, highIndex, i, true);
      lVwap = anchoredVwap(candles, lowIndex, i, false);
    }
    const prevTrend = trend;
    if (bar.high === h) trend = true;
    if (bar.low === l) trend = false;

    if (i > 0) {
      const prevC = candles[i - 1]!.close;
      const currC = bar.close;
      const up = prevC <= hVwapPrev && currC > hVwap;
      const down = prevC >= hVwapPrev && currC < hVwap;
      const ts = new Date(bar.timestamp).toISOString().replace('T', ' ').slice(0, 16);
      if (up || down) {
        crosses.push({
          ts,
          dir: up ? 'BUY' : 'SELL',
          close: +currC.toFixed(6),
          hVwap: +hVwap.toFixed(6),
          lVwap: +lVwap.toFixed(6),
        });
      }
      if ((trend && !prevTrend) || (!trend && prevTrend)) {
        flips.push({
          ts,
          dir: trend ? 'BUY' : 'SELL',
          close: +currC.toFixed(6),
          hVwap: +hVwap.toFixed(6),
        });
      }
    }
  }

  console.log('\n=== Crosses da linha AZUL (hVwap) — últimas 20 ===');
  for (const c of crosses.slice(-20)) console.log(c);
  console.log('\n=== Trend flips (lógica antiga) — últimas 15 ===');
  for (const f of flips.slice(-15)) console.log(f);

  const target = Date.parse('2026-09-02T13:30:00.000Z');
  let idx = candles.findIndex((c) => Math.abs(c.timestamp - target) < 60_000);
  if (idx < 0) idx = candles.findIndex((c) => c.timestamp >= target);
  console.log('\n=== Novo detector @ 13:30 UTC ===');
  console.log('bar', idx, new Date(candles[idx]!.timestamp).toISOString());
  const hit = detectSwingAnchoredVwapSignal(candles.slice(0, idx + 1), { lookbackLength: 50 });
  console.log(
    hit
      ? {
          dir: hit.direction,
          entry: hit.entryPrice,
          hVwap: hit.activeVwap,
          strength: hit.strength,
          ts: new Date(hit.barCloseTs).toISOString(),
        }
      : null
  );

  const t2 = Date.parse('2026-09-02T16:00:00.000Z');
  const i2 = candles.findIndex((c) => Math.abs(c.timestamp - t2) < 60_000);
  console.log('\n=== Novo detector @ 16:00 UTC (não deve ser só por flip) ===');
  const hit2 = detectSwingAnchoredVwapSignal(candles.slice(0, i2 + 1), { lookbackLength: 50 });
  console.log(
    hit2
      ? {
          dir: hit2.direction,
          entry: hit2.entryPrice,
          ts: new Date(hit2.barCloseTs).toISOString(),
        }
      : null
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
