import { NextResponse } from 'next/server';
import { fetchTopMovers } from '@/lib/marketData';

/**
 * Endpoint para buscar os Top Movers (maiores ganhadores) da Binance Futures
 * Retorna os 15 principais pares com maior variação positiva nas últimas 24h
 */
export async function GET() {
  try {
    const topMovers = await fetchTopMovers(15);

    return NextResponse.json({
      success: true,
      topMovers,
      count: topMovers.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao buscar Top Movers:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao buscar Top Movers',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}






