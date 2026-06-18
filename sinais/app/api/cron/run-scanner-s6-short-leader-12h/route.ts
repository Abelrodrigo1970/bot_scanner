import { NextRequest, NextResponse } from 'next/server';
import { runScannerS6ShortLeader12hPipeline } from '@/lib/scannerS6ShortLeader12hStrategy';

/**
 * Scanner 6 Short Leader 12h — SHORT rank #1 (0h/8h/12h/20h PT), fecho 12h, SL +7%.
 * Agendar 10–15 min após run-universe-scans ou invocar manualmente com ?force=1.
 */
async function runInBackground(force: boolean): Promise<void> {
  try {
    const result = await runScannerS6ShortLeader12hPipeline({
      force,
      logPrefix: '[Scanner6-Short-Leader-12h Cron]',
    });
    console.log('[Scanner6-Short-Leader-12h Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner6-Short-Leader-12h Cron] erro:', err);
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
      message: 'Scanner 6 Short Leader 12h iniciado em background',
      force,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner6-Short-Leader-12h Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar Scanner 6 Short Leader 12h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
