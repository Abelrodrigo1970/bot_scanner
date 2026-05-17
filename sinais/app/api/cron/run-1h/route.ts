import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron agregado 1h:
 * - run-signals: MA200_VOLATILE 4h + MA_CROSS_1H (se activa)
 * - run-ma-volatile: MA_VOLATILE (MA60 1h; universo MaCrossBelow)
 */
async function run1hInBackground(origin: string, authHeader: string): Promise<void> {
  try {
    console.log('[Run-1h BG] Iniciando agregado 1h...');

    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;

    const calls = [
      `${origin}/api/cron/run-signals`,
      `${origin}/api/cron/run-ma-volatile`,
    ];

    const results = await Promise.allSettled(
      calls.map((url) => fetch(url, { method: 'GET', headers, cache: 'no-store' }))
    );

    let okCount = 0;
    for (let i = 0; i < results.length; i++) {
      const endpoint = calls[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        okCount++;
        console.log(`[Run-1h BG] ${endpoint} -> HTTP ${result.value.status}`);
      } else {
        console.error(`[Run-1h BG] ${endpoint} -> erro`, result.reason);
      }
    }

    console.log(`[Run-1h BG] Agregado 1h finalizado: ${okCount}/${calls.length} chamadas OK`);
  } catch (error) {
    console.error('[Run-1h BG] Erro fatal:', error);
  }
}

function resolveInternalOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const url = request.nextUrl;
  const isLocalHost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0';
  const protocol = isLocalHost ? 'http:' : url.protocol;
  return `${protocol}//${url.host}`;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    const origin = resolveInternalOrigin(request);

    run1hInBackground(origin, authHeader || (cronSecret ? `Bearer ${cronSecret}` : ''));

    return NextResponse.json({
      success: true,
      message:
        'Processamento agregado 1h em background: MA200 4h + MA Cross 1h (MA12/MA30) + MA60 1h',
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
