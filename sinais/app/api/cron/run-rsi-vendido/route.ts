import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** @deprecated rsi_vendido LONG descontinuado (Set 2026). */

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  return NextResponse.json({
    success: true,
    deprecated: true,
    message: 'rsi_vendido LONG (4h) descontinuado.',
  });
}
