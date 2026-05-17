import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron agregado 15m:
 * - MA_CROSS_5M (candles 5m, URL: /api/cron/run-volume-spike-15m)
 * - EMA Ribbon 15m via /api/cron/run-rsi-15m
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
      `${origin}/api/cron/run-rsi-15m`,
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
        console.log(`[Run-15m BG] ${endpoint} -> HTTP ${result.value.status}`);
      } else {
        console.error(`[Run-15m BG] ${endpoint} -> erro`, result.reason);
      }
    }

    console.log(`[Run-15m BG] Agregado 15m finalizado: ${okCount}/${calls.length} chamadas OK`);
  } catch (error) {
    console.error('[Run-15m BG] Erro fatal:', error);
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

    run15mInBackground(origin, authHeader || (cronSecret ? `Bearer ${cronSecret}` : ''));

    return NextResponse.json({
      success: true,
      message: 'Processamento agregado 15m (MA Cross 5m + RSI 15m) iniciado em background',
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
