/** npx tsx scripts/debug-sell-at-bar.ts HUSDT — EMA no fecho 14:10 UTC vs 14:05 (entrada 0,13834) */
import { fetchCandles } from '../lib/marketData';
import { getCloses, calculateLastEMA } from '../lib/indicators';

const symbol = (process.argv[2] || 'HUSDT').toUpperCase();

async function main() {
  const n = 1500;
  const candles = await fetchCandles(symbol, '5m', n);
  const closes = getCloses(candles);
  const t10 = new Date('2026-04-24T14:10:00.000Z').getTime();
  const i10 = candles.findIndex((c) => c.timestamp === t10);
  if (i10 < 0) {
    console.log('Vela 14:10 UTC não encontrada.');
    process.exit(0);
  }
  console.log('Vela 14:10 UTC close', closes[i10], '— janela', n, 'fechos\n');
  const to10 = closes.slice(0, i10 + 1);
  const to5 = closes.slice(0, i10);
  const p30 = calculateLastEMA(to5, 30);
  const p200 = calculateLastEMA(to5, 200);
  const c30 = calculateLastEMA(to10, 30);
  const c200 = calculateLastEMA(to10, 200);
  console.log('Após 14:05: E30', p30, 'E200', p200, '  prev 30>=200 ?', p30! >= p200!);
  console.log('Após 14:10: E30', c30, 'E200', c200, '  curr 30<200 ?', c30! < c200!);
  console.log('SELL (death cross neste fecho):', p30! >= p200! && c30! < c200!);
}

main().catch(console.error);
