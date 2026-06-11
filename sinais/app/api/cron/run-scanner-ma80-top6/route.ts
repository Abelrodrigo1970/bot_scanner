import { NextRequest, NextResponse } from 'next/server';
import { runScannerMa80Top6Pipeline } from '@/lib/scannerMa80Top6Strategy';

/**
 * Rotação Scanner 5 Top 6 — fecha tudo e recompra ranks 1,4–8 (excl. #2 #3) após scan diário, SL -5%.
 * Agendar 1×/dia (ex. 00:10 UTC) ou invocar manualmente com ?force=1.
 */
async function runInBackground(force: boolean): Promise<void> {
  try {
    const result = await runScannerMa80Top6Pipeline({
      force,
      logPrefix: '[Scanner5-MA80-Top6 Cron]',
    });
    console.log('[Scanner5-MA80-Top6 Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner5-MA80-Top6 Cron] erro:', err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const force = request.nextUrl.searchParams.get('force') === '1';

    runInBackground(force);

    return NextResponse.json({
      success: true,
      message: 'Scanner 5 MA80 Top 6 iniciado em background',
      force,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner5-MA80-Top6 Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar rotação Scanner 5 MA80 Top 6',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
