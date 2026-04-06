import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { prisma } from '@/lib/db';
import { executeSignalReal, closeActivePositionForSymbol } from '@/lib/tradingExecutor';

/**
 * Cron dedicado para RSI_15M (RSI 15m, Top Volatilidade).
 * Gera sinais e auto-executa com reversal close (igual à lógica MA_VOLATILE).
 */
async function runRsi15mInBackground(): Promise<void> {
  try {
    console.log('[Run-RSI-15m BG] Iniciando RSI 15m...');
    // Buffer de 5 min para garantir que sinais criados no início do runAllStrategies são capturados
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['RSI', 'VOLUME_SPIKE', 'VOLUME_SPIKE_15M', 'MA200_VOLATILE', 'MA_VOLATILE'],
    });

    const rsi15mStrategy = await prisma.strategy.findFirst({
      where: { name: 'RSI_15M', isActive: true },
    });

    if (rsi15mStrategy) {
      const RSI_15M_MIN_STRENGTH = 60;
      const rsiParams  = JSON.parse(rsi15mStrategy.params || '{}');
      const rsiExchange = (rsiParams.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

      const newSignals = await prisma.signal.findMany({
        where: {
          strategyId: rsi15mStrategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: RSI_15M_MIN_STRENGTH },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of newSignals) {
        try {
          const closeResult = await closeActivePositionForSymbol(sig.symbol, rsiExchange);
          if (closeResult.closed) {
            console.log(`[Run-RSI-15m BG] 🔄 Posição anterior fechada em ${sig.symbol}: ${closeResult.message}`);
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
            exchange: rsiExchange,
          });

          if (execResult.success && execResult.orderId) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
            console.log(`[Run-RSI-15m BG] ✅ Auto-executado: ${sig.symbol} ${sig.direction} order ${execResult.orderId}`);
          } else {
            console.warn(`[Run-RSI-15m BG] ⚠️ Auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-RSI-15m BG] ❌ Erro auto-exec ${sig.symbol}:`, err);
        }
      }
    }

    console.log(`[Run-RSI-15m BG] Concluído: ${signalsCreated} sinais criados`);
  } catch (error) {
    console.error('[Run-RSI-15m BG] Erro fatal:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    runRsi15mInBackground();

    const now = new Date();
    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (RSI 15m Top Volatilidade)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron RSI 15m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron RSI 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
