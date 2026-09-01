import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * @deprecated stch15long descontinuado (Set 2026). Remover job */5 * * * * do cron-job.org.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    console.warn('[Run-5m] Obsoleto — stch15long descontinuado. Remover cron */5 * * * *.');

    return NextResponse.json({
      success: true,
      deprecated: true,
      message: 'Cron 5m obsoleto (stch15long descontinuado). Remover do cron-job.org.',
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron 5m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 5m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
