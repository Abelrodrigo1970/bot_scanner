import { NextRequest, NextResponse } from 'next/server';
import { runEmaRibbonBuy15mPipeline } from '@/lib/cron15mStrategies';

/**
 * Cron dedicado 15m: EMA_SCALPING (BUY — tendência de alta + retração), se activa.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    runEmaRibbonBuy15mPipeline().catch((error) => {
      console.error('[Run-15m-strategies BG] Erro fatal:', error);
    });

    const now = new Date();
    return NextResponse.json({
      success: true,
      message: 'Processamento em background (EMA Ribbon Scalping BUY 15m)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron 15m estratégias:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
