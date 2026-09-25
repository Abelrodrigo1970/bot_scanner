import { NextRequest, NextResponse } from 'next/server';
import { syncBybitMissingStopLosses } from '@/lib/tradingExecutor';

/**
 * Cron 4h: verifica posições Bybit abertas sem stopLoss Full e reaplica SL.
 * Agendar no cron-job.org: 0 every-4-hours * * *  (00, 04, 08, 12, 16, 20) Europe/Lisbon
 * Header: Authorization: Bearer CRON_SECRET
 *
 * Query opcional: ?maxFix=15 — limita quantas posições SEM SL tenta reparar
 * por pedido (evita timeout Railway ~60s quando há dezenas em falta).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const maxFixRaw = request.nextUrl.searchParams.get('maxFix');
    const maxFix =
      maxFixRaw != null && Number.isFinite(Number(maxFixRaw))
        ? Math.max(1, Math.min(50, Math.floor(Number(maxFixRaw))))
        : 20;

    console.log(`[sync-bybit-sl] A verificar posições sem SL (maxFix=${maxFix})...`);
    const sync = await syncBybitMissingStopLosses({ maxFix });

    console.log(
      `[sync-bybit-sl] checked=${sync.checked} fixed=${sync.fixed} skipped=${sync.skipped}` +
        (sync.dustClosed.length ? ` dustClosed=${sync.dustClosed.join(',')}` : '') +
        (sync.conditionalOnly.length ? ` condOnly=${sync.conditionalOnly.join(',')}` : '') +
        (sync.missing.length ? ` MISSING=${sync.missing.join(',')}` : '') +
        (sync.remaining ? ` remaining=${sync.remaining}` : '')
    );

    return NextResponse.json({
      success: true,
      checked: sync.checked,
      fixed: sync.fixed,
      skipped: sync.skipped,
      dustClosed: sync.dustClosed,
      missing: sync.missing,
      conditionalOnly: sync.conditionalOnly,
      remaining: sync.remaining,
      errors: sync.errors,
      details: sync.details,
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
