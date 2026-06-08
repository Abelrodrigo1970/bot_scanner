import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';
import { prisma } from '@/lib/db';
import {
  autoExecuteNewSignalsForStrategy,
  RSI_1H_AUTO_EXEC_STRATEGY_NAMES,
} from '@/lib/autoExecuteNewSignals';
import { cleanupBybitOrphanOpenOrders } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/**
 * Executa sinais em background (fire-and-forget):
 * Estratégias 1h activas na BD (RSI, Pivot Boss).
 * Auto-executa ordens: estratégias RSI 1h (allowBuy/allowSell).
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando estratégias 1h...');
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['MA_CROSS_5M', 'EMA_SCALPING', 'AFASTAMENTO_MEDIO_30M'],
    });

    const autoMinStrength = getAutoExecuteMinStrength();

    const rsiStrategies = await prisma.strategy.findMany({
      where: {
        name: { in: [...RSI_1H_AUTO_EXEC_STRATEGY_NAMES] },
        isActive: true,
      },
    });

    for (const rsiStrategy of rsiStrategies) {
      await autoExecuteNewSignalsForStrategy({
        strategy: rsiStrategy,
        startedAt,
        minStrength: autoMinStrength,
        logPrefix: `[Run-Signals BG] ${rsiStrategy.name}`,
      });
    }

    const update24h = await update24hResults();

    let updateHighLow = { updated: 0, errors: 0 };
    if (hour === 8 && minute < 10) {
      updateHighLow = await updateMissingHighLow24h();
    }

    const orphanCleanup = await cleanupBybitOrphanOpenOrders();
    if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
      console.log(
        `[Run-Signals BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
          (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
      );
    }

    console.log(
      `[Run-Signals BG] Concluído: ${signalsCreated} sinais, 24h: ${update24h.updated}, high/low: ${updateHighLow.updated}`
    );
  } catch (error) {
    console.error('[Run-Signals BG] Erro fatal:', error);
  }
}

/**
 * Endpoint de cron para estratégias 1h activas (RSI, Pivot Boss).
 * MA Cross 15m (MA12/30): /api/cron/run-volume-spike-15m. EMA 15m: /api/cron/run-rsi-15m.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    runSignalsInBackground(hour, minute);

    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (estratégias 1h activas)',
      executedAt: now.toISOString(),
      nextExecution: `${(hour + 1) % 24}:00`,
    });
  } catch (error) {
    console.error('Erro no cron job:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron job',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
