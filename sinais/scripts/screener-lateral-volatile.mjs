/**
 * Screener: mercado LATERAL (4h) — |EMA21 − EMA70| < 10% nos últimos 15 dias
 * ------------------------------------------------------------------
 * Critério: em todas as velas 4h dos últimos 15 dias (90 barras),
 *   |EMA21 − EMA70| / EMA70 < 10%
 *
 * Fonte: Binance Futures USDT-M (API pública)
 * Uso: node scripts/screener-lateral-volatile.mjs
 */

import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { EMA } = require('technicalindicators');

const CONFIG = {
  interval: '4h',
  klineLimit: 200,
  maFast: 21,
  maSlow: 70,
  maSpreadMaxPct: 10,
  lookbackDays: 15,
  minVolumeUsdt: 5_000_000,
  concurrency: 5,
};

const LOOKBACK_BARS = CONFIG.lookbackDays * 6; // 4h → 6/dia
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
  const closed = candles.slice(0, -1);
  const closes = closed.map((c) => c.close);
  if (closes.length < CONFIG.maSlow + LOOKBACK_BARS) return null;

  const emaFast = EMA.calculate({ values: closes, period: CONFIG.maFast });
  const emaSlow = EMA.calculate({ values: closes, period: CONFIG.maSlow });
  if (emaFast.length < LOOKBACK_BARS || emaSlow.length < LOOKBACK_BARS) return null;

  let maxSpread = 0;
  for (let k = 0; k < LOOKBACK_BARS; k++) {
    const fast = emaFast[emaFast.length - 1 - k];
    const slow = emaSlow[emaSlow.length - 1 - k];
    if (!(slow > 0)) return null;
    const spread = (Math.abs(fast - slow) / slow) * 100;
    if (spread >= CONFIG.maSpreadMaxPct) return null;
    if (spread > maxSpread) maxSpread = spread;
  }

  const lastFast = emaFast[emaFast.length - 1];
  const lastSlow = emaSlow[emaSlow.length - 1];
  const lastSpread = (Math.abs(lastFast - lastSlow) / lastSlow) * 100;
  return {
    lastClose: closes[closes.length - 1],
    ema21: lastFast,
    ema70: lastSlow,
    spreadPct: lastSpread,
    maxSpreadPct: maxSpread,
  };
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
  console.log('Screener LATERAL — |EMA21−EMA70| < 10% (4h, últimos 15 dias)');
  console.log(
    `TF=${CONFIG.interval} | |EMA${CONFIG.maFast}−EMA${CONFIG.maSlow}| < ${CONFIG.maSpreadMaxPct}% × ${CONFIG.lookbackDays}d | vol≥${(CONFIG.minVolumeUsdt / 1e6).toFixed(0)}M`
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
      const metrics = analyzeSymbol(candles);
      if (!metrics) return null;
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
    .sort((a, b) => a.spreadPct - b.spreadPct);

  console.log(`\n=== ${matches.length} símbolos LATERAIS (${CONFIG.interval}) ===\n`);
  if (matches.length) {
    console.table(
      matches.map((m) => ({
        Symbol: m.symbol,
        'Spread%': Number(m.spreadPct.toFixed(2)),
        'Max15d%': Number(m.maxSpreadPct.toFixed(2)),
        EMA21: Number(m.ema21.toFixed(6)),
        EMA70: Number(m.ema70.toFixed(6)),
        Close: m.lastClose,
        Vol24hM: Number(((m.quoteVolume24h || 0) / 1e6).toFixed(1)),
      }))
    );
  }

  const out = {
    scannedAt: new Date().toISOString(),
    config: { ...CONFIG, lookbackBars: LOOKBACK_BARS },
    candidates: symbols.length,
    matches: matches.map((m) => ({
      symbol: m.symbol,
      spreadPct: +m.spreadPct.toFixed(3),
      maxSpreadPct: +m.maxSpreadPct.toFixed(3),
      ema21: m.ema21,
      ema70: m.ema70,
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
