import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron agregado 30m:
 * - AFASTAMENTO_MEDIO_30M (velas 30m; universo Scanner 3 em 1h)
 *
 * Agendar no cron-job.org: a cada 30 min, 8h–23h (ver CRON_SETUP.md).
 * Não corre no run-1h nem no run-signals (excluída de propósito).
 */
async function run30mInBackground(origin: string, authHeader: string): Promise<void> {
  try {
    console.log('[Run-30m BG] Iniciando agregado 30m...');

    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;

    const calls = [`${origin}/api/cron/run-afastamento-30m`];

    const results = await Promise.allSettled(
      calls.map((url) => fetch(url, { method: 'GET', headers, cache: 'no-store' }))
    );

    let okCount = 0;
    for (let i = 0; i < results.length; i++) {
      const endpoint = calls[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        okCount++;
        console.log(`[Run-30m BG] ${endpoint} -> HTTP ${result.value.status}`);
      } else {
        console.error(`[Run-30m BG] ${endpoint} -> erro`, result.reason);
      }
    }

    console.log(`[Run-30m BG] Agregado 30m finalizado: ${okCount}/${calls.length} chamadas OK`);
  } catch (error) {
    console.error('[Run-30m BG] Erro fatal:', error);
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

    run30mInBackground(origin, authHeader || (cronSecret ? `Bearer ${cronSecret}` : ''));

    return NextResponse.json({
      success: true,
      message:
        'Processamento agregado 30m iniciado (Afastamento médio 30m). Agendar */30 no cron-job.org.',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron agregado 30m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 30m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
