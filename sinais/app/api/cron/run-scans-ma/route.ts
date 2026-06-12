import { NextRequest, NextResponse } from 'next/server';

/** Scanner Bybit Vol1h/MA200 removido — usar Scanner 1 (/api/cron/run-universe-scans). */
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
      'Scan Bybit MA200 removido. Use /api/cron/run-universe-scans (Scanner 1) e remova este job do cron-job.org.',
    executedAt: new Date().toISOString(),
  });
}
