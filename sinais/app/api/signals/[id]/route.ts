import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchCurrentPrice } from '@/lib/marketData';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const signal = await prisma.signal.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        symbol: true,
        direction: true,
        timeframe: true,
        strategyId: true,
        strategyName: true,
        entryPrice: true,
        stopLoss: true,
        target1: true,
        target2: true,
        target3: true,
        strength: true,
        status: true,
        generatedAt: true,
        lastCheckedAt: true,
        extraInfo: true,
        price24h: true,
        result24h: true,
        status24h: true,
        high24h: true,
        low24h: true,
        // executedAt/executionOrderId omitidos se BD não tiver
        strategy: true,
      },
    });

    if (!signal) {
      return NextResponse.json({ error: 'Sinal não encontrado' }, { status: 404 });
    }

    // Busca preço atual
    let currentPrice = null;
    try {
      currentPrice = await fetchCurrentPrice(signal.symbol);
    } catch (error) {
      console.error('Erro ao buscar preço atual:', error);
    }

    return NextResponse.json({ signal, currentPrice });
  } catch (error) {
    console.error('Erro ao buscar sinal:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar sinal' },
      { status: 500 }
    );
  }
}

