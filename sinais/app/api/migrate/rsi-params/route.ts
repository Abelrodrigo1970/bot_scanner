import { NextRequest, NextResponse } from 'next/server';

/** RSI 1h foi descontinuada — endpoint mantido para compatibilidade. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    message: 'Estratégia RSI foi removida — migração não aplicada.',
  });
}
