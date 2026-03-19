import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';

/**
 * Executa sinais RSI em background (fire-and-forget).
 * Volume Spike tem crons separados: /api/cron/run-volume-spike e /api/cron/run-volume-spike-15m
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando RSI...');
    const signalsCreated = await runAllStrategies({ exclude: ['VOLUME_SPIKE', 'VOLUME_SPIKE_15M'] });

    const update24h = await update24hResults();

    let updateHighLow = { updated: 0, errors: 0 };
    if (hour === 8 && minute < 10) {
      updateHighLow = await updateMissingHighLow24h();
    }

    console.log(
      `[Run-Signals BG] Concluído: ${signalsCreated} sinais, 24h: ${update24h.updated}, high/low: ${updateHighLow.updated}`
    );
  } catch (error) {
    console.error('[Run-Signals BG] Erro fatal:', error);
  }
}

/**
 * Endpoint de cron para RSI
 * Volume Spike tem crons separados (/api/cron/run-volume-spike, /api/cron/run-volume-spike-15m)
 * Resposta imediata - processamento em background evita timeout 502
 */
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

    // Fire-and-forget: responde imediatamente, processa em background
    runSignalsInBackground(hour, minute);

    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (RSI)',
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

