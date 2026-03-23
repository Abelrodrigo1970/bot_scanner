import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';

/**
 * Cron dedicado para MA_VOLATILE.
 * Executa em background para evitar timeout.
 */
async function runMaVolatileInBackground(): Promise<void> {
  try {
    console.log('[Run-MA_VOLATILE BG] Iniciando MA_VOLATILE...');

    // Exclui todas as outras estratégias para ficar apenas MA_VOLATILE
    const signalsCreated = await runAllStrategies({
      exclude: ['RSI', 'VOLUME_SPIKE', 'VOLUME_SPIKE_15M'],
    });

    console.log(`[Run-MA_VOLATILE BG] Concluído: ${signalsCreated} sinais criados`);
  } catch (error) {
    console.error('[Run-MA_VOLATILE BG] Erro fatal:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Fire-and-forget
    runMaVolatileInBackground();

    const now = new Date();
    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (MA_VOLATILE)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron MA_VOLATILE:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron job',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

