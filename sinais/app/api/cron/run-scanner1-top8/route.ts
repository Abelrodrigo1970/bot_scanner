import { NextRequest, NextResponse } from 'next/server';
import { runScanner1Top8Pipeline } from '@/lib/scanner1Top8Strategy';

/**
 * Rotação Scanner 1 Top 6 — fecha tudo e recompra ranks 1,2,5–8 (excl. #3 #4) após cada scan, SL -5%.
 * Agendar 10–15 min após run-universe-scans ou invocar manualmente (?force=1 para repetir o mesmo scan).
 */
async function runInBackground(force: boolean): Promise<void> {
  try {
    const result = await runScanner1Top8Pipeline({
      force,
      logPrefix: '[Scanner1-Top8 Cron]',
    });
    console.log('[Scanner1-Top8 Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner1-Top8 Cron] erro:', err);
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
      message: 'Scanner 1 Top 6 iniciado em background',
      force,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner1-Top8 Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar rotação Scanner 1 Top 6',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
