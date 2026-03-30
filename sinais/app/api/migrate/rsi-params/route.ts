import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const NEW_PARAMS = {
  period: 14,
  buyThreshold: 60,
  sellThreshold: 40,
  maPeriod: 200,
  allowBuy: true,
  allowSell: true,
  exchange: 'bybit',
};

const NEW_DISPLAY_NAME = 'RSI Top Volatilidade (60/40)';

const NEW_DESCRIPTION =
  'Só Top Voláteis 1h. BUY quando RSI cruza acima de 60 E preço > MA200 → SL -5% | TP1 +5% (35%) | TP2 +11% (35%) | 30% às 24h. SELL quando RSI cruza abaixo de 40 E preço < MA200 → SL +5% | TP1 -5% (30%) | TP2 -11% (35%) | 35% às 24h.';

/**
 * GET /api/migrate/rsi-params
 * Actualiza os params da estratégia RSI para os novos valores (60/40, SL 5%, TP 5%/11%).
 * Protegido por CRON_SECRET. Executar uma só vez.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const strategy = await prisma.strategy.findUnique({ where: { name: 'RSI' } });

    if (!strategy) {
      return NextResponse.json({ error: 'Estratégia RSI não encontrada na BD' }, { status: 404 });
    }

    const before = JSON.parse(strategy.params || '{}');

    const updated = await prisma.strategy.update({
      where: { name: 'RSI' },
      data: {
        displayName: NEW_DISPLAY_NAME,
        description: NEW_DESCRIPTION,
        params: JSON.stringify(NEW_PARAMS),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Params RSI actualizados com sucesso.',
      before: { displayName: strategy.displayName, params: before },
      after:  { displayName: updated.displayName,  params: NEW_PARAMS },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
