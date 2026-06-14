import { NextRequest, NextResponse } from 'next/server';
import { run15mStrategiesPipeline } from '@/lib/cron15mStrategies';

/**
 * Cron 15m: MA Cross 12×30 + Pivot Boss Bear 15m + Rompimento de Acumulação 15m
 * (velas 15m, Scanner 1).
 */
async function run15mInBackground(now: Date): Promise<void> {
  console.log('[Run-15m BG] Iniciando MA Cross 12×30 + Pivot Boss Bear 15m + Rompimento Acumulação 15m...');

  try {
    const result = await run15mStrategiesPipeline(now);
    const ma = result.maCross;
    const pb = result.pivotBoss;
    const bk = result.breakout;
    console.log(
      `[Run-15m BG] MA Cross -> ${ma.status}` +
        (typeof ma.signalsCreated === 'number' ? ` (${ma.signalsCreated} sinais)` : '')
    );
    console.log(
      `[Run-15m BG] Pivot Boss 15m -> ${pb.status}` +
        (typeof pb.signalsCreated === 'number' ? ` (${pb.signalsCreated} sinais)` : '')
    );
    console.log(
      `[Run-15m BG] Rompimento Acumulação 15m -> ${bk.status}` +
        (typeof bk.signalsCreated === 'number' ? ` (${bk.signalsCreated} sinais)` : '')
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
      message: 'Processamento MA Cross 12×30 + Pivot Boss Bear 15m + Rompimento Acumulação 15m iniciado em background',
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
