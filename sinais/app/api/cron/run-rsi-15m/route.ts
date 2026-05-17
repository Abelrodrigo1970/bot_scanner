import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { cleanupBybitOrphanOpenOrders } from '@/lib/tradingExecutor';

/**
 * Cron dedicado 15m: EMA_SCALPING (BUY) e EMA_SCALPING_SELL (se activa).
 * RSI_15M, RSI_BYBIT_15M, MA_CROSS_15M e VOLUME_SPIKE foram removidas.
 */
async function runCron15mStrategiesInBackground(): Promise<void> {
  try {
    console.log('[Run-15m-strategies BG] Iniciando EMA Ribbon + restantes 15m...');

    const signalsCreated = await runAllStrategies({
      exclude: [
        'MA_CROSS_5M',
        'MA_CROSS_1H',
        'MA200_VOLATILE',
        'MA_VOLATILE',
        'MACD_HISTOGRAM_PMO',
        'AFASTAMENTO_MEDIO',
        'AFASTAMENTO_MEDIO_30M',
        'RSI_OVERBOUGHT_DROP_1H',
      ],
    });

    const orphanCleanup = await cleanupBybitOrphanOpenOrders();
    if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
      console.log(
        `[Run-15m-strategies BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
          (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
      );
    }

    console.log(`[Run-15m-strategies BG] Concluído: ${signalsCreated} sinais criados`);
  } catch (error) {
    console.error('[Run-15m-strategies BG] Erro fatal:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    runCron15mStrategiesInBackground();

    const now = new Date();
    return NextResponse.json({
      success: true,
      message: 'Processamento em background (EMA Ribbon Scalping 15m; estratégias RSI/MA30×200 removidas)',
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
