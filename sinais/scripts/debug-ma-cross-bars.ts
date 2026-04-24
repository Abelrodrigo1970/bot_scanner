/**
 * Uso: npx tsx scripts/debug-ma-cross-bars.ts HUSDT
 * Mostra EMA30/200 no penúltimo e último fecho (igual motor: sem vela aberta;
 * a legenda do gráfico muitas vezes ainda actualiza a vela a formar).
 */
import { fetchCandles } from '../lib/marketData';
import { getCloses, calculateLastEMA } from '../lib/indicators';

const symbol = (process.argv[2] || 'HUSDT').toUpperCase();
const n = Math.min(1500, Math.max(200, parseInt(process.argv[3] || '600', 10) || 600));

function emaOn(arr: number[], p: number) {
  return calculateLastEMA(arr, p);
}

async function main() {
  const candles = await fetchCandles(symbol, '5m', n);
  const closes = getCloses(candles);
  const a = closes.slice(0, -2);
  const b = closes.slice(0, -1);
  const tPrev = new Date(candles[candles.length - 3].timestamp).toISOString();
  const tLast = new Date(candles[candles.length - 2].timestamp).toISOString();
  const lastClose = closes[closes.length - 2];
  const dist =
    b.length >= 200
      ? (Math.abs(lastClose - (emaOn(b, 200) as number)) / (emaOn(b, 200) as number)) * 100
      : null;

  const p30_ = emaOn(a, 30);
  const p200_ = emaOn(a, 200);
  const c30_ = emaOn(b, 30);
  const c200_ = emaOn(b, 200);

  console.log(`${symbol} 5m  ${n} fechos  (libraries EMA, Binance fapi)\n`);
  console.log('Após fecho penúltimo  (', tPrev, '):');
  console.log('  EMA30:', p30_?.toFixed(5), '  EMA200:', p200_?.toFixed(5), '  30>=200 ?', p30_ != null && p200_ != null && p30_ >= p200_);
  console.log('Após último fechado  (', tLast, '):  close =', lastClose);
  console.log('  EMA30:', c30_?.toFixed(5), '  EMA200:', c200_?.toFixed(5), '  30<200 ?', c30_ != null && c200_ != null && c30_ < c200_);
  console.log('-');
  const sellCross =
    p30_ != null &&
    p200_ != null &&
    c30_ != null &&
    c200_ != null &&
    p30_ >= p200_ &&
    c30_ < c200_;
  console.log('Condição SELL (death cross neste fecho):', sellCross);
  console.log('|close−EMA200|/EMA200 (%)  [último fechado]:', dist?.toFixed(2) ?? 'n/a', '  (bloqueia SELL se > 6% com default params)');
  console.log(
    '\nNota: a legenda do gráfico usa muitas vezes a vela em formação; o bot só a vela fechada.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
