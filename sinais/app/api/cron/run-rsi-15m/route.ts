import { NextRequest, NextResponse } from 'next/server';

/** EMA Ribbon Scalping removido do bot_scanner. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    message: 'EMA_SCALPING (Ribbon Scalping) removido do bot_scanner.',
    executedAt: new Date().toISOString(),
  });
}
