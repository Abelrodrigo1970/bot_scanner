import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { prisma } from '@/lib/db';
import { closeActivePositionForSymbol, executeSignalReal } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/**
 * Cron dedicado para MA_VOLATILE.
 * Executa em background para evitar timeout.
 */
async function runMaVolatileInBackground(): Promise<void> {
  try {
    console.log('[Run-MA_VOLATILE BG] Iniciando MA_VOLATILE...');
    const startedAt = new Date();

    // Exclui todas as outras estratégias para ficar apenas MA_VOLATILE
    const signalsCreated = await runAllStrategies({
      exclude: ['RSI', 'VOLUME_SPIKE', 'VOLUME_SPIKE_15M'],
    });

    // Auto-exec apenas para MA_VOLATILE:
    // 1) fecha posição ativa do símbolo (se houver)
    // 2) abre nova posição do sinal
    const ma60Strategy = await prisma.strategy.findFirst({
      where: { name: 'MA_VOLATILE', isActive: true },
    });

    if (ma60Strategy) {
      const autoMinStrength = getAutoExecuteMinStrength();
      const newMa60Signals = await prisma.signal.findMany({
        where: {
          strategyId: ma60Strategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: autoMinStrength },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of newMa60Signals) {
        try {
          const closeResult = await closeActivePositionForSymbol(sig.symbol);
          if (closeResult.closed) {
            console.log(
              `[Run-MA_VOLATILE BG] 🔄 Fecho prévio ${sig.symbol}: ${closeResult.side} ${closeResult.quantity} (order ${closeResult.orderId})`
            );
          } else {
            console.log(`[Run-MA_VOLATILE BG] ℹ️ ${closeResult.message}`);
          }

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
            console.log(`[Run-MA_VOLATILE BG] ✅ Auto-executado: ${sig.symbol} order ${execResult.orderId}`);
          } else {
            console.warn(`[Run-MA_VOLATILE BG] ⚠️ Auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-MA_VOLATILE BG] ❌ Erro auto-exec ${sig.symbol}:`, err);
        }
      }
    }

    console.log(`[Run-MA_VOLATILE BG] Concluído: ${signalsCreated} sinais criados`);
  } catch (error) {
    console.error('[Run-MA_VOLATILE BG] Erro fatal:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Fire-and-forget
    runMaVolatileInBackground();

    const now = new Date();
    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (MA_VOLATILE)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron MA_VOLATILE:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron job',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

