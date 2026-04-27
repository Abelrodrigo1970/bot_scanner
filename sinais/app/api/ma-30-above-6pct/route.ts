import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchMa30Above6Pct } from '@/lib/marketData';

/**
 * GET: Lista MA30 > 9% acima da MA200 (1h) guardada na base de dados.
 */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await prisma.ma30Above6Pct.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    console.error('Erro ao buscar MA30 > 9% MA200:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao buscar o scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Executa scan, substitui registos e grava na BD.
 */
export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await fetchMa30Above6Pct(100);

    await prisma.ma30Above6Pct.deleteMany({});

    await prisma.ma30Above6Pct.createMany({
      data: items.map((item) => ({
        symbol: item.symbol,
        lastPrice: item.lastPrice,
        ma30: item.ma30,
        ma200: item.ma200,
        distPriceMa200: item.distPriceMa200,
        distMa30Ma200: item.distMa30Ma200,
        rank: item.rank,
      })),
    });

    const saved = await prisma.ma30Above6Pct.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items: saved,
      count: saved.length,
      message: 'MA30 > 9% MA200 atualizado com sucesso',
    });
  } catch (error: any) {
    console.error('Erro ao atualizar MA30 > 9% MA200:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao atualizar o scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
