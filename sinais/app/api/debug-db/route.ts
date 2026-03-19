import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Endpoint de debug para verificar conexão e dados do banco
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const databaseUrl = process.env.DATABASE_URL || '';
    const isPostgreSQL = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');
    const isSQLite = databaseUrl.startsWith('file:');

    // Contar registros
    const strategyCount = await prisma.strategy.count();
    const signalCount = await prisma.signal.count();
    
    // Buscar algumas estratégias
    const strategies = await prisma.strategy.findMany({
      select: {
        id: true,
        name: true,
        displayName: true,
        isActive: true,
      },
    });

    // Buscar alguns sinais
    const recentSignals = await prisma.signal.findMany({
      take: 5,
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        symbol: true,
        direction: true,
        strength: true,
        generatedAt: true,
        strategyName: true,
      },
    });

    // Testar conexão
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      success: true,
      database: {
        type: isPostgreSQL ? 'PostgreSQL' : isSQLite ? 'SQLite' : 'Unknown',
        url: databaseUrl.replace(/:[^:@]+@/, ':****@'), // Ocultar senha
        connected: true,
      },
      counts: {
        strategies: strategyCount,
        signals: signalCount,
      },
      strategies: strategies,
      recentSignals: recentSignals,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Erro no debug:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        database: {
          type: 'Unknown',
          url: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@') || 'Not set',
          connected: false,
        },
      },
      { status: 500 }
    );
  }
}

