import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

/**
 * IPv4 de saída do ambiente (o mesmo que serviços externos como a Binance veem).
 * Autenticação: sessão (browser com login) ou Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const bearerOk = !!(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const sessionOk = await isAuthenticated();

  if (!bearerOk && !sessionOk) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Falha ao consultar ipify: HTTP ${res.status}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { ip?: string };
    const ipv4 = data.ip?.trim() || '';

    return NextResponse.json({
      ipv4,
      note:
        'Cola este IPv4 na whitelist da API Binance. Sem Static Outbound IP na Railway, o IP pode mudar após deploys ou mudanças de infra.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
