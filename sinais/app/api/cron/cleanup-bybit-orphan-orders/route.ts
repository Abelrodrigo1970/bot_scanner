import { NextRequest, NextResponse } from 'next/server';
import {
  cleanupBybitOrphanOpenOrders,
  syncBybitMissingStopLosses,
} from '@/lib/tradingExecutor';

/**
 * Cancela ordens Bybit linear em pares sem posição aberta (TP/SL órfãs após fecho na bolsa)
 * e reaplica SL em posições abertas que estejam sem stopLoss.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const orphan = await cleanupBybitOrphanOpenOrders();
    const sync = await syncBybitMissingStopLosses();
    return NextResponse.json({
      success: true,
      cancelledSymbols: orphan.cancelledSymbols,
      orphanErrors: orphan.errors,
      slSync: sync,
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
