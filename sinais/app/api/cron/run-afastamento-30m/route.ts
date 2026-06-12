import { NextRequest, NextResponse } from 'next/server';

/** Afastamento 30m removido do bot_scanner. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    message: 'AFASTAMENTO_MEDIO_30M removido do bot_scanner.',
    executedAt: new Date().toISOString(),
  });
}
