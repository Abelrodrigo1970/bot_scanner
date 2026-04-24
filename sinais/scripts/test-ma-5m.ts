/**
 * Uso: npx tsx scripts/test-ma-5m.ts [SYMBOL]
 * EMA 30/200 em 5m (Binance Futures) — `calculateLastEMA` (biblioteca technicalindicators).
 *
 * A EMA200 precisa de muitas velas para coincidir com o gráfico da Binance (até ~1500);
 * com ~200–250 velas o valor fica visivelmente mais baixo.
 */
import { fetchCandles, fetchCurrentPrice } from '../lib/marketData';
import { getCloses, calculateLastEMA } from '../lib/indicators';

const symbol = (process.argv[2] || 'FLUIDUSDT').toUpperCase();

function printBlock(
  label: string,
  closes: number[],
  candles: { timestamp: number }[],
  lastPrice: number | null
) {
  const closedCloses = closes.slice(0, -1);
  const lastClosed = closedCloses[closedCloses.length - 1];
  const tLastClosed = new Date(candles[candles.length - 2].timestamp).toISOString();
  const lastForming = closes[closes.length - 1];
  const tForming = new Date(candles[candles.length - 1].timestamp).toISOString();

  const e30c = calculateLastEMA(closedCloses, 30);
  const e200c = calculateLastEMA(closedCloses, 200);
  const e30o = calculateLastEMA(closes, 30);
  const e200o = calculateLastEMA(closes, 200);

  const px = lastPrice ?? lastForming;
  const dist200 =
    e200o != null ? (Math.abs(px - e200o) / e200o) * 100 : null;

  console.log(`--- ${label} (${closes.length} fechos) ---`);
  console.log('A) Só velas fechadas — último fecho fechado:', lastClosed, '@', tLastClosed, 'UTC');
  console.log('   EMA30 :', e30c?.toFixed(4) ?? 'n/a', '  EMA200:', e200c?.toFixed(4) ?? 'n/a');
  console.log('B) Inclui vela aberta — fecho provisório:', lastForming, '@', tForming, 'UTC');
  console.log('   EMA30 :', e30o?.toFixed(4) ?? 'n/a', '  EMA200:', e200o?.toFixed(4) ?? 'n/a');
  if (lastPrice != null) {
    console.log('   Preço mark (ticker):', lastPrice, '  |preço−EMA200|/EMA200:', dist200?.toFixed(2) + '%');
  }
  console.log('');
}

async function main() {
  let mark: number | null = null;
  try {
    mark = await fetchCurrentPrice(symbol);
  } catch {
    // ignora
  }

  const short = await fetchCandles(symbol, '5m', 250);
  const w400 = await fetchCandles(symbol, '5m', 400);
  const med = await fetchCandles(symbol, '5m', 600);
  const long = await fetchCandles(symbol, '5m', 1500);

  if (long.length < 205) {
    console.error('Poucos candles:', long.length);
    process.exit(1);
  }

  console.log(`${symbol}  5m  Binance USDT-M  —  comparação lookback (API)\n`);
  printBlock('250 velas', getCloses(short), short, mark);
  printBlock('400 velas (pedido: teste EMA200 com 400 fechos de histórico)', getCloses(w400), w400, mark);
  printBlock('600 velas (padrão actual do motor EMA, MA200×3 mín. 600 teto 1000)', getCloses(med), med, mark);
  printBlock('1500 velas (máx. API, mais perto do gráfico web)', getCloses(long), long, mark);

  const refE30 = 1.727;
  const refE200 = 1.734;
  const refPx = 1.723;
  const b = getCloses(long);
  const e30B = calculateLastEMA(b, 30);
  const e200B = calculateLastEMA(b, 200);
  const dE30 = e30B != null ? (e30B - refE30) * 1000 : null;
  const dE200 = e200B != null ? (e200B - refE200) * 1000 : null;
  const dPx = mark != null ? (mark - refPx) * 1000 : null;

  const c400 = getCloses(w400);
  const e30_400 = calculateLastEMA(c400, 30);
  const e200_400 = calculateLastEMA(c400, 200);
  const dE30_400 = e30_400 != null ? (e30_400 - refE30) * 1000 : null;
  const dE200_400 = e200_400 != null ? (e200_400 - refE200) * 1000 : null;

  console.log(
    'Comparação com legenda do ecrã (aprox.):  EMA30=1,727  EMA200=1,734  preço=1,723  (5m perp)'
  );
  console.log(
    'Diferença 400 velas vs legenda (×0,001):  ΔEMA30=',
    dE30_400 != null && Number.isFinite(dE30_400) ? dE30_400.toFixed(1) : 'n/a',
    '  ΔEMA200=',
    dE200_400 != null && Number.isFinite(dE200_400) ? dE200_400.toFixed(1) : 'n/a'
  );
  console.log(
    'Diferença 1500 velas vs legenda (×0,001):  ΔEMA30=',
    dE30 != null && Number.isFinite(dE30) ? dE30.toFixed(1) : 'n/a',
    '  ΔEMA200=',
    dE200 != null && Number.isFinite(dE200) ? dE200.toFixed(1) : 'n/a',
    '  Δmark=',
    dPx != null && Number.isFinite(dPx) ? dPx.toFixed(1) : 'n/a'
  );
  console.log(
    'Nota: o ecrã é noutro instante; no mesmo segundo os valores aproximam-se (1500) ou coincidem em 1 casa.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
