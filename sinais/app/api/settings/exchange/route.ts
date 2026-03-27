import { NextResponse } from 'next/server';

/**
 * GET /api/settings/exchange
 * Retorna a exchange activa (lida da variável de ambiente EXCHANGE).
 */
export async function GET() {
  const exchange = (process.env.EXCHANGE || 'binance').toLowerCase();
  return NextResponse.json({
    exchange: exchange === 'bybit' ? 'bybit' : 'binance',
    label:    exchange === 'bybit' ? 'Bybit' : 'Binance',
  });
}
