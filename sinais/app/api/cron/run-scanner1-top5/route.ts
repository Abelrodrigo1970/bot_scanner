import { NextRequest, NextResponse } from 'next/server';
import { runScanner1Top5Pipeline } from '@/lib/scanner1Top8Strategy';

/**
 * Rotação Scanner 2 Top 4 — fecha tudo e recompra ranks 1–4 do Scanner 2 após cada scan, SL -3%.
 * Agendar 10–15 min após run-universe-scans ou invocar manualmente (?force=1 para repetir o mesmo scan).
 */
async function runInBackground(force: boolean): Promise<void> {
  try {
    const result = await runScanner1Top5Pipeline({
      force,
      logPrefix: '[Scanner1-Top5 Cron]',
    });
    console.log('[Scanner1-Top5 Cron] resultado:', result);
  } catch (err) {
    console.error('[Scanner1-Top5 Cron] erro:', err);
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
      message: 'Scanner 2 Top 4 iniciado em background',
      force,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Scanner1-Top5 Cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar rotação Scanner 2 Top 4',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
