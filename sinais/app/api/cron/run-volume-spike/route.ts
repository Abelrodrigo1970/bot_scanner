import { NextRequest, NextResponse } from 'next/server';

/**
 * Volume Spike 1h foi descontinuado. Mantém o endpoint para crons antigos não falharem.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    message: 'Estratégia VOLUME_SPIKE removida — nenhum processamento executado.',
    executedAt: new Date().toISOString(),
  });
}
