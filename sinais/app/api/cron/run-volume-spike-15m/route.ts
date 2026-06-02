import { NextRequest, NextResponse } from 'next/server';
import { runMaCross15mPipeline } from '@/lib/cron15mStrategies';

/**
 * Endpoint MA Cross 15m (MA12/MA30) — agendado a cada 15 min.
 * (URL legada `run-volume-spike-15m` mantida para o cron / run-15m agregado.)
 * O gating de horário/FDS e a execução estão em `runMaCross15mPipeline`.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();

    // Background (resposta imediata para não estourar o timeout do Railway).
    runMaCross15mPipeline(now).catch((error) => {
      console.error('[MA Cross 15m BG] Erro fatal:', error);
    });

    return NextResponse.json({
      success: true,
      message: 'MA Cross 15m iniciado em background (universo: Scanner 1)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron MA Cross 15m:', error);
    return NextResponse.json(
      {
        error: 'Erro ao executar cron MA Cross 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
