import { NextRequest, NextResponse } from 'next/server';
import { runScanner2ShortLeader24hPipeline } from '@/lib/scanner2ShortLeader24hStrategy';

/**
 * Scanner 2 Short Leader 24h — SHORT ranks #1–#2, fecho 24h, SL +40%.
 * Agendar 10–15 min após run-universe-scans ou invocar manualmente com ?force=1.
 */
async function runInBackground(force: boolean): Promise<void> {
  try {
    const result = await runScanner2ShortLeader24hPipeline({
      force,
      logPrefix: '[Scanner2-Short-Leader-24h Cron]',
    });
    console.log('[Scanner2-Short-Leader-24h Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner2-Short-Leader-24h Cron] erro:', err);
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
      message: 'Scanner 2 Short Leader 24h iniciado em background',
      force,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner2-Short-Leader-24h Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar Scanner 2 Short Leader 24h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
