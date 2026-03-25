import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';
import { prisma } from '@/lib/db';
import { executeSignalReal } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/**
 * Executa sinais de 1h em background (fire-and-forget):
 * RSI + MA200_VOLATILE. Auto-executa ordens para sinais com força suficiente.
 * Volume Spike 1h tem cron separado: /api/cron/run-volume-spike
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando estratégias 1h (RSI + MA200)...');
    const startedAt = new Date();

    const signalsCreated = await runAllStrategies({
      exclude: ['VOLUME_SPIKE', 'VOLUME_SPIKE_15M', 'MA_VOLATILE'],
    });

    // Auto-exec para RSI e MA200_VOLATILE
    const autoMinStrength = getAutoExecuteMinStrength();
    const rsiStrategy = await prisma.strategy.findFirst({ where: { name: 'RSI', isActive: true } });
    const ma200Strategy = await prisma.strategy.findFirst({ where: { name: 'MA200_VOLATILE', isActive: true } });

    const strategyIds = [rsiStrategy?.id, ma200Strategy?.id].filter(Boolean) as string[];

    if (strategyIds.length > 0) {
      const newSignals = await prisma.signal.findMany({
        where: {
          strategyId: { in: strategyIds },
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: autoMinStrength },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of newSignals) {
        try {
          const execResult = await executeSignalReal({
            id: sig.id,
            symbol: sig.symbol,
            direction: sig.direction as 'BUY' | 'SELL',
            entryPrice: sig.entryPrice,
            stopLoss: sig.stopLoss,
            target1: sig.target1,
            target2: sig.target2,
            target3: sig.target3 ?? null,
            strength: sig.strength,
            strategyName: sig.strategyName,
            status: sig.status,
          });

          if (execResult.success && execResult.orderId) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
            console.log(`[Run-Signals BG] ✅ Auto-executado: ${sig.symbol} ${sig.direction} (${sig.strategyName}) order ${execResult.orderId}`);
          } else {
            console.warn(`[Run-Signals BG] ⚠️ Auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-Signals BG] ❌ Erro auto-exec ${sig.symbol}:`, err);
        }
      }
    }

    const update24h = await update24hResults();

    let updateHighLow = { updated: 0, errors: 0 };
    if (hour === 8 && minute < 10) {
      updateHighLow = await updateMissingHighLow24h();
    }

    console.log(
      `[Run-Signals BG] Concluído: ${signalsCreated} sinais, 24h: ${update24h.updated}, high/low: ${updateHighLow.updated}`
    );
  } catch (error) {
    console.error('[Run-Signals BG] Erro fatal:', error);
  }
}

/**
 * Endpoint de cron para estratégias 1h (RSI + MA200).
 * Volume Spike tem cron separado (/api/cron/run-volume-spike).
 * Resposta imediata - processamento em background evita timeout 502
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

    // Fire-and-forget: responde imediatamente, processa em background
    runSignalsInBackground(hour, minute);

    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (RSI + MA200 1h)',
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
