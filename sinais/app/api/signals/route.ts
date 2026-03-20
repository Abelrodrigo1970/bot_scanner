import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Garantir que o banco está inicializado
    const dbReady = await ensureDatabase();
    if (!dbReady) {
      const dbUrl = process.env.DATABASE_URL || '';
      const hasPostgresUrl = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Verifique DATABASE_URL. Se usar PostgreSQL no Railway, o schema.prisma deve ter provider = "postgresql". Tente /api/init-db ou /api/health para diagnóstico.',
          dbConfigured: !!dbUrl,
          isPostgresUrl: hasPostgresUrl,
        },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const direction = searchParams.get('direction');
    const timeframe = searchParams.get('timeframe');
    const strategy = searchParams.get('strategy');
    const minStrengthParam = searchParams.get('minStrength');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const onlyOpen = searchParams.get('onlyOpen') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '1000', 10) || 1000, 5000);

    const where: any = {};

    if (symbol) {
      where.symbol = { contains: symbol };
    }
    if (direction && (direction === 'BUY' || direction === 'SELL')) {
      where.direction = direction;
    }
    if (timeframe) {
      where.timeframe = timeframe;
    }
    if (strategy) {
      // Se for ID (cuid ~25 chars), filtrar por strategyId; senão por strategyName (compat texto)
      if (strategy.length >= 20 && /^[a-z0-9]+$/i.test(strategy)) {
        where.strategyId = strategy;
      } else {
        where.strategyName = { contains: strategy };
      }
    }
    // Filtro de força: padrão 70 (apenas sinais com força >= 70). Passar minStrength=0 para ver todos.
    const minStrengthValue = minStrengthParam !== null && minStrengthParam !== ''
      ? parseInt(minStrengthParam, 10)
      : 70;
    if (!isNaN(minStrengthValue)) {
      where.strength = { gte: minStrengthValue };
    }
    
    // Filtros de data
    if (dateFrom || dateTo) {
      where.generatedAt = {};
      if (dateFrom) {
        where.generatedAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Adicionar 23:59:59 ao final do dia para incluir todo o dia
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.generatedAt.lte = endDate;
      }
    }
    
    // Filtro para mostrar apenas sinais sem resultado 24h
    if (onlyOpen) {
      where.status24h = null;
    }
    
    // Filtro para mostrar apenas sinais com resultado 24h (para página de resultados)
    const onlyClosed = searchParams.get('onlyClosed') === 'true';
    if (onlyClosed) {
      where.status24h = 'CLOSED';
      where.result24h = { not: null };
    }

    // Select explícito: omite executedAt/executionOrderId para funcionar em BD
    // que ainda não tenha essas colunas (ex: Railway antes de db push)
    const signals = await prisma.signal.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      take: Math.min(limit || 1000, 5000),
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
        // executedAt/executionOrderId omitidos para BD sem essas colunas
        strategy: true,
      },
    });

    return NextResponse.json({ signals });
  } catch (error) {
    console.error('Erro ao buscar sinais:', error);
    return NextResponse.json(
      { 
        error: 'Erro ao buscar sinais',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}

