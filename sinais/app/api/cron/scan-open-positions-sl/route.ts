import { NextRequest, NextResponse } from 'next/server';
import { syncBybitMissingStopLosses } from '@/lib/tradingExecutor';

/**
 * Scan dedicado: percorre TODAS as posições Bybit abertas e coloca SL Full
 * onde faltar (paginação completa + reparação).
 *
 * Não é um scanner de universo — é um scan de risco sobre trades abertos.
 * Agendar no cron-job.org a cada 10 min (Europe/Lisbon):
 *   */10 * * * *
 * Header: Authorization: Bearer CRON_SECRET
 *
 * Query: ?maxFix=20 (default) — quantas posições sem SL reparar por pedido.
 * Se `remaining > 0`, volta a chamar no próximo tick (ou reexecuta o job).
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
        : 25;

    console.log(`[scan-open-positions-sl] A verificar SLs (maxFix=${maxFix})...`);

    // Até 2 passes no mesmo pedido se ainda houver remaining (timeout Railway ~60–90s)
    let sync = await syncBybitMissingStopLosses({ maxFix });
    let passes = 1;
    if ((sync.remaining ?? 0) > 0) {
      const again = await syncBybitMissingStopLosses({ maxFix });
      passes = 2;
      sync = {
        ...again,
        fixed: sync.fixed + again.fixed,
        dustClosed: [...sync.dustClosed, ...again.dustClosed],
        missing: again.missing,
        errors: [...sync.errors, ...again.errors],
        details: [...(sync.details || []), ...(again.details || [])],
        // checked/skipped do último pass (universo completo)
        checked: again.checked,
        skipped: again.skipped,
        remaining: again.remaining,
        conditionalOnly: again.conditionalOnly,
      };
    }

    console.log(
      `[scan-open-positions-sl] passes=${passes} checked=${sync.checked} fixed=${sync.fixed} skipped=${sync.skipped}` +
        (sync.remaining ? ` remaining=${sync.remaining}` : '') +
        (sync.missing.length ? ` MISSING=${sync.missing.join(',')}` : '')
    );

    return NextResponse.json({
      success: true,
      scan: 'open-positions-sl',
      passes,
      checked: sync.checked,
      fixed: sync.fixed,
      skipped: sync.skipped,
      dustClosed: sync.dustClosed,
      missing: sync.missing,
      remaining: sync.remaining,
      conditionalOnly: sync.conditionalOnly,
      errors: sync.errors,
      details: sync.details,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[scan-open-positions-sl]', error);
    return NextResponse.json(
      {
        error: 'Erro no scan de SL em posições abertas',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
