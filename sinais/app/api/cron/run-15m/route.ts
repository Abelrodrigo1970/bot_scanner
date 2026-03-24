import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron agregado 15m:
 * - VOLUME_SPIKE_15M
 * - MA_VOLATILE (MA60 15m)
 *
 * Dispara os crons dedicados em background para manter a mesma lógica já existente.
 */
async function run15mInBackground(origin: string, authHeader: string): Promise<void> {
  try {
    console.log('[Run-15m BG] Iniciando agregado 15m...');

    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;

    const calls = [
      `${origin}/api/cron/run-volume-spike-15m`,
      `${origin}/api/cron/run-ma-volatile`,
    ];

    const results = await Promise.allSettled(
      calls.map((url) => fetch(url, { method: 'GET', headers, cache: 'no-store' }))
    );

    for (let i = 0; i < results.length; i++) {
      const endpoint = calls[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        console.log(`[Run-15m BG] ${endpoint} -> HTTP ${result.value.status}`);
      } else {
        console.error(`[Run-15m BG] ${endpoint} -> erro`, result.reason);
      }
    }

    console.log('[Run-15m BG] Agregado 15m disparado com sucesso');
  } catch (error) {
    console.error('[Run-15m BG] Erro fatal:', error);
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

    run15mInBackground(origin, authHeader || (cronSecret ? `Bearer ${cronSecret}` : ''));

    return NextResponse.json({
      success: true,
      message: 'Processamento agregado 15m iniciado em background (Volume Spike 15m + MA60)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron agregado 15m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
