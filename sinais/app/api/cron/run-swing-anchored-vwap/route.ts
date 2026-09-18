import { NextRequest, NextResponse } from 'next/server';

/** Descontinuado: Swing Anchored VWAP 15m. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: false,
    skipped: true,
    reason: 'SWING_ANCHORED_VWAP_15M descontinuada',
  });
}
