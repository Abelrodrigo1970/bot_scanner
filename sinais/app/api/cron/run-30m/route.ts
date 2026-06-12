import { NextRequest, NextResponse } from 'next/server';

/** Afastamento 30m removido do bot_scanner — endpoint mantido para crons antigos. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    message:
      'Cron 30m desactivado: estratégia Afastamento médio 30m removida do bot_scanner. Remova este job no cron-job.org.',
    executedAt: new Date().toISOString(),
  });
}
