import { fetchCandles, dropFormingCandle, filterToBybitMarketSymbols } from '../lib/marketData';
import { detectLiquidityPoolSweep } from '../lib/liquidityPoolDetector';
import { LIQUIDITY_POOLS_PRO_15M_PARAMS } from '../lib/strategyMigrations';
import { getBuiltinScanDefinition } from '../lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '../lib/universeScanner';

async function main() {
  const def = getBuiltinScanDefinition('UNIVERSE_TOP30_PRICE_CHANGE_24H');
  if (!def) throw new Error('no def');
  const rows = await scanSymbolUniverse(def);
  const sorted = [...rows].sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa)).slice(0, 15);
  const syms = await filterToBybitMarketSymbols(sorted.map((r) => r.symbol));
  console.log('Top15 bybit:', syms.join(', '));

  const todayHits: string[] = [];
  for (const sym of syms.slice(0, 10)) {
    const raw = await fetchCandles(sym, '15m', 300);
    const c = dropFormingCandle(raw, '15m');
    for (let i = c.length - 12; i < c.length; i++) {
      const slice = c.slice(0, i + 1);
      const bar = slice[slice.length - 1]!;
      const hit = detectLiquidityPoolSweep(slice, LIQUIDITY_POOLS_PRO_15M_PARAMS);
      if (hit && hit.barCloseTs === bar.timestamp) {
        const line = `${sym} ${new Date(hit.barCloseTs).toISOString().slice(0, 16)} ${hit.direction} @${hit.entryPrice.toFixed(6)} str${hit.strength}`;
        todayHits.push(line);
        console.log('HIT', line);
      }
    }
    const lastHit = detectLiquidityPoolSweep(c, LIQUIDITY_POOLS_PRO_15M_PARAMS);
    if (lastHit) console.log('LAST', sym, lastHit.direction, lastHit.entryPrice, lastHit.strength);
  }
  console.log('Hits last 12 bars:', todayHits.length);
}

main().catch(console.error);
