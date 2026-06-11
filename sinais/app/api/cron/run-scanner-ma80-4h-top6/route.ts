import { NextRequest, NextResponse } from 'next/server';
import { runScannerMa804hTop6Pipeline } from '@/lib/scannerMa804hTop6Strategy';

/**
 * Rotação Scanner 6 Top 6 — fecha tudo e recompra ranks 1,2,4,5,7–8 (excl. #3 #6) após cada scan 4h, SL -7%.
 * Agendar 10–15 min após run-universe-scans ou invocar manualmente com ?force=1.
 */
async function runInBackground(force: boolean): Promise<void> {
  try {
    const result = await runScannerMa804hTop6Pipeline({
      force,
      logPrefix: '[Scanner6-MA80-4h-Top6 Cron]',
    });
    console.log('[Scanner6-MA80-4h-Top6 Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner6-MA80-4h-Top6 Cron] erro:', err);
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
      message: 'Scanner 6 MA80 4h Top 6 iniciado em background',
      force,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner6-MA80-4h-Top6 Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar rotação Scanner 6 MA80 4h Top 6',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
