/**
 * Screener: Criptos em mercado LATERAL mas com VOLATILIDADE alta
 * ------------------------------------------------------------------
 * Critério:
 *   1. ADX baixo         -> não há tendência direcional forte
 *   2. ATR% alto          -> mas o preço se move bastante (bom p/ range/grid)
 *   3. Donchian% apertado -> preço "preso" numa faixa nas últimas N barras
 *
 * Fonte: Binance Futures USDT-M (API pública)
 * Uso: node scripts/screener-lateral-volatile.mjs
 */

import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { ADX, ATR } = require('technicalindicators');

const CONFIG = {
  interval: '4h',
  klineLimit: 200,
  adxLength: 14,
  adxMax: 20,
  atrLength: 14,
  atrPctMin: 1.5,
  donchianLength: 50,
  donchianPctMax: 12,
  minVolumeUsdt: 5_000_000,
  concurrency: 5,
};

const BASE_URL = 'https://fapi.binance.com';

async function getAllSymbols() {
  const res = await fetch(`${BASE_URL}/fapi/v1/exchangeInfo`);
  if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
  const data = await res.json();
  return data.symbols
    .filter(
      (s) =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING' &&
        !String(s.symbol).includes('_')
    )
    .map((s) => s.symbol);
}

async function getVolumeMap() {
  const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr`);
  if (!res.ok) throw new Error(`ticker/24hr ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const t of data) map.set(t.symbol, parseFloat(t.quoteVolume));
  return map;
}

async function getKlines(symbol, interval, limit) {
  const url = `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${symbol}: ${res.status}`);
  const raw = await res.json();
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

function analyzeSymbol(candles) {
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);

  const adxResult = ADX.calculate({ high, low, close, period: CONFIG.adxLength });
  const lastAdx = adxResult.at(-1)?.adx ?? null;

  const atrResult = ATR.calculate({ high, low, close, period: CONFIG.atrLength });
  const lastAtr = atrResult.at(-1) ?? null;
  const lastClose = close.at(-1);
  const atrPct = lastAtr && lastClose ? (lastAtr / lastClose) * 100 : null;

  const window = candles.slice(-CONFIG.donchianLength);
  const donchHigh = Math.max(...window.map((c) => c.high));
  const donchLow = Math.min(...window.map((c) => c.low));
  const donchPct = donchLow > 0 ? ((donchHigh - donchLow) / donchLow) * 100 : null;

  return { adx: lastAdx, atrPct, donchPct, lastClose };
}

function passesFilter({ adx, atrPct, donchPct }) {
  if (adx == null || atrPct == null || donchPct == null) return false;
  return adx < CONFIG.adxMax && atrPct >= CONFIG.atrPctMin && donchPct <= CONFIG.donchianPctMax;
}

async function runInBatches(items, worker, batchSize) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(worker));
    results.push(...batchResults);
    process.stdout.write(`\r  ${Math.min(i + batchSize, items.length)}/${items.length}`);
    await new Promise((r) => setTimeout(r, 80));
  }
  process.stdout.write('\n');
  return results;
}

async function main() {
  console.log('═'.repeat(72));
  console.log('Screener LATERAL + VOLÁTIL (ADX baixo · ATR% alto · Donchian apertado)');
  console.log(
    `TF=${CONFIG.interval} | ADX<${CONFIG.adxMax} | ATR%≥${CONFIG.atrPctMin} | Donchian≤${CONFIG.donchianPctMax}% | vol≥${(CONFIG.minVolumeUsdt / 1e6).toFixed(0)}M`
  );
  console.log('═'.repeat(72));

  console.log('Buscando símbolos e volumes…');
  const [allSymbols, volumeMap] = await Promise.all([getAllSymbols(), getVolumeMap()]);

  const symbols = allSymbols.filter((s) => (volumeMap.get(s) ?? 0) >= CONFIG.minVolumeUsdt);
  console.log(`Analisando ${symbols.length} símbolos (após filtro de liquidez)…`);

  const results = await runInBatches(
    symbols,
    async (symbol) => {
      const candles = await getKlines(symbol, CONFIG.interval, CONFIG.klineLimit);
      if (candles.length < Math.max(CONFIG.donchianLength, CONFIG.adxLength + 5)) {
        return null;
      }
      const metrics = analyzeSymbol(candles);
      if (!passesFilter(metrics)) return null;
      return {
        symbol,
        ...metrics,
        quoteVolume24h: volumeMap.get(symbol) ?? 0,
      };
    },
    CONFIG.concurrency
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.warn(`${failed.length} símbolos falharam ao buscar dados (ignorados).`);
  }

  const matches = results
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)
    .sort((a, b) => b.atrPct - a.atrPct);

  console.log(`\n=== ${matches.length} símbolos LATERAIS + VOLÁTEIS (${CONFIG.interval}) ===\n`);
  if (matches.length) {
    console.table(
      matches.map((m) => ({
        Symbol: m.symbol,
        ADX: Number(m.adx.toFixed(1)),
        'ATR%': Number(m.atrPct.toFixed(2)),
        'Range%': Number(m.donchPct.toFixed(2)),
        Close: m.lastClose,
        Vol24hM: Number(((m.quoteVolume24h || 0) / 1e6).toFixed(1)),
      }))
    );
  }

  const out = {
    scannedAt: new Date().toISOString(),
    config: CONFIG,
    candidates: symbols.length,
    matches: matches.map((m) => ({
      symbol: m.symbol,
      adx: +m.adx.toFixed(3),
      atrPct: +m.atrPct.toFixed(3),
      donchPct: +m.donchPct.toFixed(3),
      lastClose: m.lastClose,
      quoteVolume24h: m.quoteVolume24h,
    })),
  };

  const path = new URL('./out-screener-lateral-volatile.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
  return matches;
}

main().catch((err) => {
  console.error('Erro no screener:', err);
  process.exit(1);
});
