import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron agregado 1h: Pivot Boss Bear 15m (Scanner 1, via run-signals).
 */
async function run1hInBackground(origin: string, authHeader: string): Promise<void> {
  try {
    console.log('[Run-1h BG] Iniciando Pivot Boss Bear 15m...');

    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;

    const url = `${origin}/api/cron/run-signals`;
    try {
      const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
      console.log(`[Run-1h BG] ${url} -> HTTP ${res.status}`);
    } catch (reason) {
      console.error(`[Run-1h BG] ${url} -> erro`, reason);
    }

    console.log('[Run-1h BG] Agregado 1h finalizado.');
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
      message: 'Processamento Pivot Boss Bear 15m iniciado (Scanner 1)',
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
