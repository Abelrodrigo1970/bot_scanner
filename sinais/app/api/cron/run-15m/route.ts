import { NextRequest, NextResponse } from 'next/server';
import { run15mStrategiesPipeline } from '@/lib/cron15mStrategies';

/**
 * Cron 15m: MA Cross 12×30 (Scanner 1) + MA Cross 12×21 (Scanner 2).
 */
async function run15mInBackground(now: Date): Promise<void> {
  console.log('[Run-15m BG] Iniciando MA Cross + engolfo (15m)...');

  try {
    const result = await run15mStrategiesPipeline(now);
    const ma = result.maCross;
    const ma21 = result.maCross12x21S2;
    const eng = result.engolfo;
    console.log(
      `[Run-15m BG] MA Cross 12×30 -> ${ma.status}` +
        (typeof ma.signalsCreated === 'number' ? ` (${ma.signalsCreated} sinais)` : '')
    );
    console.log(
      `[Run-15m BG] MA Cross 12×21 S2 -> ${ma21.status}` +
        (typeof ma21.signalsCreated === 'number' ? ` (${ma21.signalsCreated} sinais)` : '')
    );
    console.log(
      `[Run-15m BG] engolfo -> ${eng.status}` +
        (typeof eng.signalsCreated === 'number' ? ` (${eng.signalsCreated} sinais)` : '')
    );
  } catch (error) {
    console.error('[Run-15m BG] Falhou:', error);
  }

  console.log('[Run-15m BG] Finalizado.');
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();

    run15mInBackground(now).catch((error) => {
      console.error('[Run-15m BG] Erro fatal:', error);
    });

    return NextResponse.json({
      success: true,
      message: 'Cron 15m (MA Cross + engolfo) iniciado em background',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron 15m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
