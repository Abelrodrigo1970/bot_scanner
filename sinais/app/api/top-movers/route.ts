import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';
import { fetchTopVolatile } from '@/lib/marketData';

/**
 * GET: Retorna as top 25 criptos mais voláteis (dos últimos 3 meses) guardadas na base de dados.
 */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        { error: 'Banco de dados não está pronto', hint: 'Tente /api/init-db' },
        { status: 503 }
      );
    }

    const topVolatile = await prisma.topVolatile.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      topVolatile,
      count: topVolatile.length,
      fetchedAt: topVolatile[0]?.updatedAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    const msg = error?.message || '';
    const isTableMissing = msg.includes('"TopVolatile"') || msg.includes('does not exist') || msg.includes('P2021');
    console.error('Erro ao buscar Top Voláteis:', error);
    return NextResponse.json(
      {
        success: false,
        error: isTableMissing ? 'Tabela TopVolatile não existe' : 'Ocorreu um erro ao buscar Top Voláteis',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
        hint: isTableMissing ? 'Faça redeploy ou aceda POST /api/init-db para criar a tabela' : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Apaga os registos existentes, busca as 25 mais voláteis dos últimos 3 meses e grava na BD.
 */
export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        { error: 'Banco de dados não está pronto', hint: 'Tente /api/init-db' },
        { status: 503 }
      );
    }

    // Apagar todos os registos existentes
    await prisma.topVolatile.deleteMany({});

    // Buscar as 25 mais voláteis da Binance
    const items = await fetchTopVolatile(25);

    // Inserir na base de dados
    await prisma.topVolatile.createMany({
      data: items.map((item) => ({
        symbol: item.symbol,
        high3m: item.high3m,
        low3m: item.low3m,
        volatilityPercent: item.volatilityPercent,
        lastPrice: item.lastPrice,
        rank: item.rank,
      })),
    });

    const topVolatile = await prisma.topVolatile.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      topVolatile,
      count: topVolatile.length,
      message: 'Top Voláteis atualizados com sucesso',
    });
  } catch (error: any) {
    const msg = error?.message || '';
    const isTableMissing = msg.includes('"TopVolatile"') || msg.includes('does not exist') || msg.includes('P2021');
    console.error('Erro ao atualizar Top Voláteis:', error);
    return NextResponse.json(
      {
        success: false,
        error: isTableMissing ? 'Tabela TopVolatile não existe' : 'Ocorreu um erro ao atualizar Top Voláteis',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
        hint: isTableMissing ? 'Faça redeploy ou aceda POST /api/init-db para criar a tabela' : undefined,
      },
      { status: 500 }
    );
  }
}
