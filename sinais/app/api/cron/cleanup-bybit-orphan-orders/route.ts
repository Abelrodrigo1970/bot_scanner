import { NextRequest, NextResponse } from 'next/server';
import { cleanupBybitOrphanOpenOrders } from '@/lib/tradingExecutor';

/**
 * Cancela ordens Bybit linear em pares sem posição aberta (TP/SL órfãs após fecho na bolsa).
 * Opcional no Railway/cron além da limpeza no fim dos jobs MA 15m / RSI 15m / run-signals.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const result = await cleanupBybitOrphanOpenOrders();
    return NextResponse.json({
      success: true,
      cancelledSymbols: result.cancelledSymbols,
      errors: result.errors,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cleanup-bybit-orphan-orders]', error);
    return NextResponse.json(
      {
        error: 'Erro ao limpar ordens Bybit órfãs',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
