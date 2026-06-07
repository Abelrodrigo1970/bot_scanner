import { NextResponse } from 'next/server';
import { fetchCandles } from '@/lib/marketData';

/** Diagnóstico: testa fontes de market data a partir do IP de saída do servidor. */
export async function GET() {
  const hosts = [
    'https://api.bybit.nl/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=1',
    'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=1',
    'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1',
  ];

  const probes = await Promise.all(
    hosts.map(async (url) => {
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        return {
          url: url.split('?')[0],
          status: res.status,
          ok: res.ok,
          snippet: text.slice(0, 100).replace(/\s+/g, ' '),
        };
      } catch (e) {
        return {
          url: url.split('?')[0],
          status: 0,
          ok: false,
          snippet: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );

  let fetchCandlesOk = false;
  let fetchCandlesError: string | null = null;
  try {
    const candles = await fetchCandles('BTCUSDT', '15m', 3);
    fetchCandlesOk = candles.length > 0;
  } catch (e) {
    fetchCandlesError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    env: {
      MARKET_DATA_PRIMARY: process.env.MARKET_DATA_PRIMARY ?? null,
      BYBIT_MARKET_DATA_BASE_URL: process.env.BYBIT_MARKET_DATA_BASE_URL ?? null,
      BYBIT_BASE_URL: process.env.BYBIT_BASE_URL ?? null,
    },
    probes,
    fetchCandles: fetchCandlesOk ? 'ok' : fetchCandlesError,
  });
}
