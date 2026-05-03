import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const PARAMS = {
  period: 14,
  previousBelowThreshold: 28,
  buyThreshold: 32,
  stopPercent: 3,
  symbolLimit: 400,
  minQuoteVolume: 500000,
  allowBuy: true,
  allowSell: false,
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
        displayName: 'RSI 15m Reversal (28->32)',
        description:
          'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo = scan MA30 entre −9% e −3% vs MA200 (1h).',
        isActive: true,
        params: JSON.stringify(PARAMS),
      },
      create: {
        name: 'RSI_15M',
        displayName: 'RSI 15m Reversal (28->32)',
        description:
          'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo = scan MA30 entre −9% e −3% vs MA200 (1h).',
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
