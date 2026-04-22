import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchMaCrossBelow } from '@/lib/marketData';

/**
 * GET: Retorna os registos MA Cross Below guardados na base de dados.
 * Condição: Preço < MA200 E MA30 > MA200 (diário).
 */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await prisma.maCrossBelow.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    console.error('Erro ao buscar MA Cross Below:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao buscar MA Cross Below',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Executa scan, apaga registos antigos e grava os novos na BD.
 */
export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await fetchMaCrossBelow(100);

    await prisma.maCrossBelow.deleteMany({});

    await prisma.maCrossBelow.createMany({
      data: items.map((item) => ({
        symbol:        item.symbol,
        lastPrice:     item.lastPrice,
        ma30:          item.ma30,
        ma200:         item.ma200,
        distPriceMa200: item.distPriceMa200,
        distMa30Ma200:  item.distMa30Ma200,
        rank:          item.rank,
      })),
    });

    const saved = await prisma.maCrossBelow.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      items: saved,
      count: saved.length,
      message: 'MA Cross Below atualizado com sucesso',
    });
  } catch (error: any) {
    console.error('Erro ao atualizar MA Cross Below:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao atualizar MA Cross Below',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
