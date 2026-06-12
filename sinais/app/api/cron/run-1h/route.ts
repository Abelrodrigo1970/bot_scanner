import { NextRequest, NextResponse } from 'next/server';
import { run15mStrategiesPipeline } from '@/lib/cron15mStrategies';

/**
 * @deprecated Use /api/cron/run-15m — ambas as estratégias activas correm em velas 15m.
 * Mantido para compatibilidade com jobs antigos no cron-job.org.
 */
async function run1hInBackground(now: Date): Promise<void> {
  console.warn('[Run-1h BG] Obsoleto — migrar cron-job.org para /api/cron/run-15m (*/15 * * * *)');
  try {
    await run15mStrategiesPipeline(now);
  } catch (error) {
    console.error('[Run-1h BG] Erro fatal:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();

    run1hInBackground(now);

    return NextResponse.json({
      success: true,
      deprecated: true,
      message:
        'Endpoint obsoleto. Configure apenas /api/cron/run-15m (MA Cross + Pivot Boss 15m, de 15 em 15 min).',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron 1h (legado):', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 1h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
