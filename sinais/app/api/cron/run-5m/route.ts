import { NextRequest, NextResponse } from 'next/server';
import { runScanner2StochRsi5mPipeline } from '@/lib/scanner2StochRsi5mStrategy';

/**
 * Cron 5m: Scanner 2 Stoch RSI Top 4
 * Stoch RSI (50/50/40/11) — K×D up LONG / K×D down fecha.
 */

async function run5mInBackground(): Promise<void> {
  console.log('[Run-5m BG] Iniciando Scanner 2 Stoch RSI Top 4...');
  try {
    const result = await runScanner2StochRsi5mPipeline();
    if (result.status === 'skipped') {
      console.log(`[Run-5m BG] Stoch RSI skipped: ${result.reason}`);
    } else {
      console.log(
        `[Run-5m BG] Stoch RSI -> LONG ${result.longCreated}, fechados ${result.closed}, exec ${result.executed}`
      );
    }
  } catch (error) {
    console.error('[Run-5m BG] Falhou:', error);
  }
  console.log('[Run-5m BG] Finalizado.');
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    run5mInBackground().catch((error) => {
      console.error('[Run-5m BG] Erro fatal:', error);
    });

    return NextResponse.json({
      success: true,
      message: 'Scanner 2 Stoch RSI Top 4 (5m) iniciado em background',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron 5m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 5m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
