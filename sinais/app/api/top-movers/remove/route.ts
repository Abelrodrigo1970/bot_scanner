import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => null);
    const symbolsRaw = body?.symbols;
    if (!Array.isArray(symbolsRaw) || symbolsRaw.length === 0) {
      return NextResponse.json(
        { error: 'Envie symbols como array não vazio' },
        { status: 400 }
      );
    }

    const symbols = symbolsRaw
      .map((s: unknown) => String(s || '').trim().toUpperCase())
      .filter((s: string) => /^[A-Z0-9]+$/.test(s));

    if (symbols.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum símbolo válido para remover' },
        { status: 400 }
      );
    }

    const removed = await prisma.topVolatile.deleteMany({
      where: { symbol: { in: symbols } },
    });

    const topVolatile = await prisma.topVolatile.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      removedCount: removed.count,
      topVolatile,
      count: topVolatile.length,
      message: `${removed.count} símbolo(s) removido(s) com sucesso`,
    });
  } catch (error) {
    console.error('Erro ao remover símbolos Top Voláteis:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao remover símbolos',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

