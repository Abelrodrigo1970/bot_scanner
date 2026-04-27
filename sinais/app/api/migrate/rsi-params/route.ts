import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RSI_MA30_SCAN_UNIVERSE_DESCRIPTION } from '@/lib/strategyMigrations';

const NEW_PARAMS = {
  period: 14,
  buyThreshold: 60,
  sellThreshold: 40,
  maPeriod: 200,
  buyStopPercent: 3,
  sellStopPercent: 3,
  closeAfterHours: 24,
  allowBuy: true,
  allowSell: true,
  exchange: 'binance',
};

const NEW_DISPLAY_NAME = 'RSI Top Volatilidade (60/40)';

const NEW_DESCRIPTION = RSI_MA30_SCAN_UNIVERSE_DESCRIPTION;

/**
 * GET /api/migrate/rsi-params
 * Actualiza os params da estratégia RSI para SL 3% e saída só às 24h.
 * Protegido por CRON_SECRET. Executar uma só vez.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const existing = await prisma.strategy.findUnique({ where: { name: 'RSI' } });
    const before = existing ? JSON.parse(existing.params || '{}') : null;

    const upserted = await prisma.strategy.upsert({
      where: { name: 'RSI' },
      update: {
        displayName: NEW_DISPLAY_NAME,
        description: NEW_DESCRIPTION,
        params: JSON.stringify(NEW_PARAMS),
        isActive: true,
      },
      create: {
        name: 'RSI',
        displayName: NEW_DISPLAY_NAME,
        description: NEW_DESCRIPTION,
        isActive: true,
        params: JSON.stringify(NEW_PARAMS),
      },
    });

    return NextResponse.json({
      success: true,
      message: existing ? 'Estratégia RSI atualizada.' : 'Estratégia RSI criada (não existia na BD).',
      before: before ? { displayName: existing!.displayName, params: before } : null,
      after:  { displayName: upserted.displayName, params: NEW_PARAMS },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
