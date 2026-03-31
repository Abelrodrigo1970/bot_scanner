import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const PARAMS = {
  period: 14,
  buyThreshold: 62,
  sellThreshold: 38,
  maPeriod: 200,
  allowBuy: true,
  allowSell: true,
  exchange: 'bybit',
};

/**
 * GET /api/migrate/rsi-15m
 * Cria (ou actualiza) a estratégia RSI_15M na BD de produção.
 * Protegido por CRON_SECRET. Executar uma só vez.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const strategy = await prisma.strategy.upsert({
      where: { name: 'RSI_15M' },
      update: {
        displayName: 'RSI 15m Top Volatilidade (62/38)',
        description:
          'Só Top Voláteis 15m. BUY quando RSI cruza acima de 62 E preço > MA200 → SL -5% | TP1 +5% (35%) | TP2 +11% (35%) | 30% às 24h. SELL quando RSI cruza abaixo de 38 E preço < MA200 → SL +5% | TP1 -5% (30%) | TP2 -11% (35%) | 35% às 24h.',
        isActive: true,
        params: JSON.stringify(PARAMS),
      },
      create: {
        name: 'RSI_15M',
        displayName: 'RSI 15m Top Volatilidade (62/38)',
        description:
          'Só Top Voláteis 15m. BUY quando RSI cruza acima de 62 E preço > MA200 → SL -5% | TP1 +5% (35%) | TP2 +11% (35%) | 30% às 24h. SELL quando RSI cruza abaixo de 38 E preço < MA200 → SL +5% | TP1 -5% (30%) | TP2 -11% (35%) | 35% às 24h.',
        isActive: true,
        params: JSON.stringify(PARAMS),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Estratégia RSI_15M criada/actualizada com sucesso.',
      strategy: {
        id: strategy.id,
        name: strategy.name,
        displayName: strategy.displayName,
        isActive: strategy.isActive,
        params: PARAMS,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
