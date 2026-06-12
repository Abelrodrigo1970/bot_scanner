import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';
import { cleanupBybitOrphanOpenOrders } from '@/lib/tradingExecutor';

/**
 * Executa sinais em background: Pivot Boss Bear 15m (cron 1h).
 * MA Cross 15m corre em /api/cron/run-15m.
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando Pivot Boss Bear 15m...');

    const signalsCreated = await runAllStrategies({
      exclude: ['MA_CROSS_5M'],
    });

    const update24h = await update24hResults();

    let updateHighLow = { updated: 0, errors: 0 };
    if (hour === 8 && minute < 10) {
      updateHighLow = await updateMissingHighLow24h();
    }

    const orphanCleanup = await cleanupBybitOrphanOpenOrders();
    if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
      console.log(
        `[Run-Signals BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
          (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
      );
    }

    console.log(
      `[Run-Signals BG] Concluído: ${signalsCreated} sinais, 24h: ${update24h.updated}, high/low: ${updateHighLow.updated}`
    );
  } catch (error) {
    console.error('[Run-Signals BG] Erro fatal:', error);
  }
}

/** Endpoint de cron: Pivot Boss Bear 15m. MA Cross: /api/cron/run-15m. */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    runSignalsInBackground(hour, minute);

    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (Pivot Boss Bear 15m)',
      executedAt: now.toISOString(),
      nextExecution: `${(hour + 1) % 24}:00`,
    });
  } catch (error) {
    console.error('Erro no cron job:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron job',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
