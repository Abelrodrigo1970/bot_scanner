import { NextRequest, NextResponse } from 'next/server';
import {
  cleanupBybitOrphanOpenOrders,
  syncBybitMissingStopLosses,
} from '@/lib/tradingExecutor';

/**
 * Cron a cada 10 min (recomendado):
 * 1) Cancela TP/SL órfãs em pares sem posição
 * 2) Scan de SL: percorre posições abertas e coloca SL Full onde faltar
 *
 * Este job é o “scan” associado às posições abertas — não precisa de
 * scanner de universo novo.
 *
 * Header: Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const orphan = await cleanupBybitOrphanOpenOrders();

    // Scan SL em todas as posições (paginado). maxFix=25 por pedido.
    let sync = await syncBybitMissingStopLosses({ maxFix: 25 });
    if ((sync.remaining ?? 0) > 0) {
      const again = await syncBybitMissingStopLosses({ maxFix: 25 });
      sync = {
        ...again,
        fixed: sync.fixed + again.fixed,
        dustClosed: [...sync.dustClosed, ...again.dustClosed],
        missing: again.missing,
        errors: [...sync.errors, ...again.errors],
        details: [...(sync.details || []), ...(again.details || [])],
        checked: again.checked,
        skipped: again.skipped,
        remaining: again.remaining,
        conditionalOnly: again.conditionalOnly,
      };
    }

    console.log(
      `[cleanup-bybit-orphan-orders] orphan=${orphan.cancelledSymbols.length}` +
        ` sl checked=${sync.checked} fixed=${sync.fixed} skipped=${sync.skipped}` +
        (sync.remaining ? ` remaining=${sync.remaining}` : '') +
        (sync.missing.length ? ` MISSING=${sync.missing.join(',')}` : '')
    );

    return NextResponse.json({
      success: true,
      cancelledSymbols: orphan.cancelledSymbols,
      orphanErrors: orphan.errors,
      slScan: {
        checked: sync.checked,
        fixed: sync.fixed,
        skipped: sync.skipped,
        dustClosed: sync.dustClosed,
        missing: sync.missing,
        remaining: sync.remaining,
        conditionalOnly: sync.conditionalOnly,
        errors: sync.errors,
        details: sync.details,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cleanup-bybit-orphan-orders]', error);
    return NextResponse.json(
      {
        error: 'Erro ao limpar/sincronizar Bybit',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
