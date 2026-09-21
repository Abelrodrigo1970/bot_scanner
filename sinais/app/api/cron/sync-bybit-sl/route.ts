import { NextRequest, NextResponse } from 'next/server';
import { syncBybitMissingStopLosses } from '@/lib/tradingExecutor';

/**
 * Cron 4h: verifica posições Bybit abertas sem stopLoss Full e reaplica SL.
 * Agendar no cron-job.org: 0 every-4-hours * * *  (00, 04, 08, 12, 16, 20) Europe/Lisbon
 * Header: Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    console.log('[sync-bybit-sl] A verificar posições sem SL...');
    const sync = await syncBybitMissingStopLosses();

    console.log(
      `[sync-bybit-sl] checked=${sync.checked} fixed=${sync.fixed} skipped=${sync.skipped}` +
        (sync.dustClosed.length ? ` dustClosed=${sync.dustClosed.join(',')}` : '') +
        (sync.conditionalOnly.length ? ` condOnly=${sync.conditionalOnly.join(',')}` : '') +
        (sync.missing.length ? ` MISSING=${sync.missing.join(',')}` : '')
    );

    return NextResponse.json({
      success: true,
      checked: sync.checked,
      fixed: sync.fixed,
      skipped: sync.skipped,
      dustClosed: sync.dustClosed,
      missing: sync.missing,
      conditionalOnly: sync.conditionalOnly,
      errors: sync.errors,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sync-bybit-sl]', error);
    return NextResponse.json(
      {
        error: 'Erro ao sincronizar SL Bybit',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
