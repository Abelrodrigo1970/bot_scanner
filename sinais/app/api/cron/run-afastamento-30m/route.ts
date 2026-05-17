import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';

/**
 * Cron 30m: apenas AFASTAMENTO_MEDIO_30M (velas 30m; universo Scanner 3 em 1h).
 */
async function runInBackground(): Promise<void> {
  try {
    const signalsCreated = await runAllStrategies({
      only: ['AFASTAMENTO_MEDIO_30M'],
    });
    console.log(`[Afastamento-30m BG] Concluído: ${signalsCreated} sinal(is)`);
  } catch (error) {
    console.error('[Afastamento-30m BG] Erro:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    runInBackground();

    return NextResponse.json({
      success: true,
      message: 'AFASTAMENTO_MEDIO_30M iniciado em background',
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Erro no cron afastamento 30m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
