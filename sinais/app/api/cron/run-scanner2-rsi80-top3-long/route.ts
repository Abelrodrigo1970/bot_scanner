import { NextRequest, NextResponse } from 'next/server';
import { runScanner2Rsi80Top3LongPipeline } from '@/lib/scanner2Rsi80Top3LongStrategy';

/**
 * Scanner 2 RSI>80 Top 3 LONG 4h — backup/manual.
 * Preferir após run-universe-scans; ou ?force=1.
 */
async function runInBackground(): Promise<void> {
  try {
    const result = await runScanner2Rsi80Top3LongPipeline({
      logPrefix: '[Scanner2-RSI80-Top3-LONG Cron]',
    });
    console.log('[Scanner2-RSI80-Top3-LONG Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner2-RSI80-Top3-LONG Cron] erro:', err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    runInBackground();

    return NextResponse.json({
      success: true,
      message: 'Scanner 2 RSI>80 Top 3 LONG iniciado em background',
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner2-RSI80-Top3-LONG Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar Scanner 2 RSI>80 Top 3 LONG',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
