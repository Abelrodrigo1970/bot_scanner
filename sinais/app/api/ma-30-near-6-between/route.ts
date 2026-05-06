import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchMa30Near6PriceBetween } from '@/lib/marketData';

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await prisma.ma30Near6PriceBetween.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
    });
  } catch (error: unknown) {
    console.error('Erro ao buscar scan MA30 vs MA200 (−6%…+1%):', error);
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

export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await fetchMa30Near6PriceBetween(300);

    await prisma.ma30Near6PriceBetween.deleteMany({});

    await prisma.ma30Near6PriceBetween.createMany({
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

    const saved = await prisma.ma30Near6PriceBetween.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items: saved,
      count: saved.length,
      message: 'Scan actualizado com sucesso',
    });
  } catch (error: unknown) {
    console.error('Erro ao actualizar scan MA30 vs MA200 (−6%…+1%):', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao actualizar o scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
