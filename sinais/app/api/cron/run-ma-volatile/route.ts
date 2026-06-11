import { NextRequest, NextResponse } from 'next/server';

/**
 * Estratégia MA_VOLATILE removida — endpoint mantido para crons antigos no Railway.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    message: 'Estratégia MA_VOLATILE removida — nenhum processamento executado.',
    signalsCreated: 0,
  });
}
