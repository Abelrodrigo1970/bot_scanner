import { NextRequest, NextResponse } from 'next/server';

/** RSI_15M foi descontinuada — endpoint mantido para compatibilidade. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    message: 'Estratégia RSI_15M foi removida — migração não aplicada.',
  });
}
