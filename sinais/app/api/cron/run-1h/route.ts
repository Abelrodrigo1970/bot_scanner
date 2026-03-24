import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron agregado 1h:
 * - RSI
 * - VOLUME_SPIKE (1h)
 * - MA200_VOLATILE (1h)
 *
 * Dispara os crons dedicados em background para manter a mesma lógica já existente.
 */
async function run1hInBackground(origin: string, authHeader: string): Promise<void> {
  try {
    console.log('[Run-1h BG] Iniciando agregado 1h...');

    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;

    const calls = [
      `${origin}/api/cron/run-signals`,
      `${origin}/api/cron/run-volume-spike`,
    ];

    const results = await Promise.allSettled(
      calls.map((url) => fetch(url, { method: 'GET', headers, cache: 'no-store' }))
    );

    for (let i = 0; i < results.length; i++) {
      const endpoint = calls[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        console.log(`[Run-1h BG] ${endpoint} -> HTTP ${result.value.status}`);
      } else {
        console.error(`[Run-1h BG] ${endpoint} -> erro`, result.reason);
      }
    }

    console.log('[Run-1h BG] Agregado 1h disparado com sucesso');
  } catch (error) {
    console.error('[Run-1h BG] Erro fatal:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    const origin = request.nextUrl.origin;

    run1hInBackground(origin, authHeader || (cronSecret ? `Bearer ${cronSecret}` : ''));

    return NextResponse.json({
      success: true,
      message: 'Processamento agregado 1h iniciado em background (RSI + MA200 + Volume Spike 1h)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron agregado 1h:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 1h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
