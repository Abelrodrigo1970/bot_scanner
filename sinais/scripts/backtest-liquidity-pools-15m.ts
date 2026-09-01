/**
 * Backtest Liquidity Pools 15m no Scanner 2 (últimos N dias, Binance).
 * Uso: npx tsx scripts/backtest-liquidity-pools-15m.ts [--days=14] [--topN=10]
 */
import { fetchCandles, dropFormingCandle } from '../lib/marketData';
import { detectLiquidityPoolSweep } from '../lib/liquidityPoolDetector';
import { LIQUIDITY_POOLS_PRO_15M_PARAMS } from '../lib/strategyMigrations';

const API = process.env.API_BASE || 'https://botscanner-production.up.railway.app';

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    days: Number(get('--days', '14')) || 14,
    topN: Number(get('--topN', '10')) || 10,
  };
}

async function fetchScanner2Symbols(topN: number): Promise<string[]> {
  const res = await fetch(`${API}/api/universe-scans/${UNIVERSE_CODE}`);
  if (!res.ok) throw new Error(`Scanner 2 HTTP ${res.status}`);
  const json = (await res.json()) as { rows?: { symbol: string }[] };
  return (json.rows ?? []).slice(0, topN).map((r) => r.symbol);
}

const UNIVERSE_CODE = 'UNIVERSE_TOP30_PRICE_CHANGE_24H';

function simulateHit(hit: NonNullable<ReturnType<typeof detectLiquidityPoolSweep>>): number {
  const entry = hit.entryPrice;
  const risk = Math.abs(entry - hit.stopLoss);
  if (risk <= 0) return 0;
  const sign = hit.direction === 'BUY' ? 1 : -1;
  const tp1Pct = sign * ((hit.target1 - entry) / entry) * 100;
  const tp2Pct = sign * ((hit.target2 - entry) / entry) * 100;
  const tp3Pct = sign * ((hit.target3 - entry) / entry) * 100;
  const slPct = -sign * ((hit.stopLoss - entry) / entry) * 100;
  const p1 = LIQUIDITY_POOLS_PRO_15M_PARAMS.tp1Position / 100;
  const p2 = LIQUIDITY_POOLS_PRO_15M_PARAMS.tp2Position / 100;
  const p3 = 1 - p1 - p2;
  return p1 * tp1Pct + p2 * tp2Pct + p3 * tp3Pct - 0.1;
}

async function main() {
  const { days, topN } = parseArgs();
  const symbols = await fetchScanner2Symbols(topN);
  const barsNeeded = Math.ceil((days * 24 * 60) / 15) + 100;

  console.log(`Liquidity Pools backtest — Scanner 2 top ${topN}, ~${days}d, ${symbols.length} símbolos\n`);

  const allHits: Array<{ symbol: string; hit: ReturnType<typeof detectLiquidityPoolSweep> }> = [];

  for (const symbol of symbols) {
    try {
      const raw = await fetchCandles(symbol, '15m', Math.min(1500, barsNeeded));
      const candles = dropFormingCandle(raw, '15m');
      for (let i = 80; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const hit = detectLiquidityPoolSweep(slice, LIQUIDITY_POOLS_PRO_15M_PARAMS);
        if (!hit) continue;
        const lastTs = slice[slice.length - 1]?.timestamp;
        if (hit.barCloseTs !== lastTs) continue;
        allHits.push({ symbol, hit });
      }
    } catch (e) {
      console.warn(`Skip ${symbol}:`, e);
    }
  }

  if (allHits.length === 0) {
    console.log('Sem sinais no período.');
    return;
  }

  const nets = allHits.map((h) => simulateHit(h.hit!));
  const wins = nets.filter((n) => n >= 0).length;
  const total = nets.reduce((a, n) => a + n, 0);
  const buys = allHits.filter((h) => h.hit!.direction === 'BUY');
  const sells = allHits.filter((h) => h.hit!.direction === 'SELL');

  console.log(`Sinais: ${allHits.length} (BUY ${buys.length}, SELL ${sells.length})`);
  console.log(`WR: ${((wins / allHits.length) * 100).toFixed(1)}%`);
  console.log(`Net sim (ideal TP3): ${total.toFixed(1)}% | avg ${(total / allHits.length).toFixed(2)}%/trade`);

  console.log('\nÚltimos 15 sinais:');
  for (const { symbol, hit } of allHits.slice(-15)) {
    const net = simulateHit(hit!);
    console.log(
      `${hit!.direction.padEnd(4)} ${symbol.padEnd(14)} str=${hit!.strength} net=${net.toFixed(2)}% pool=${hit!.poolLevel.toFixed(6)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
