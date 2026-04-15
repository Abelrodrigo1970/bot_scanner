import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { prisma } from '@/lib/db';
import {
  executeSignalReal,
  closeActivePositionForSymbol,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';

/**
 * Cron dedicado para MA_VOLATILE (MA60 1h).
 * Gera sinais e auto-executa com reversal close (igual à lógica MA200_VOLATILE).
 */
async function runMaVolatileInBackground(): Promise<void> {
  try {
    console.log('[Run-MA_VOLATILE BG] Iniciando MA_VOLATILE...');
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['RSI', 'RSI_15M', 'VOLUME_SPIKE', 'VOLUME_SPIKE_15M', 'MA200_VOLATILE'],
    });

    // Auto-exec MA_VOLATILE — força fixa 70
    const maVolatileStrategy = await prisma.strategy.findFirst({
      where: { name: 'MA_VOLATILE', isActive: true },
    });

    if (maVolatileStrategy) {
      const MA_VOLATILE_MIN_STRENGTH = 70;
      const maParams = JSON.parse(maVolatileStrategy.params || '{}');
      const maExchange = (maParams.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

      const newSignals = await prisma.signal.findMany({
        where: {
          strategyId: maVolatileStrategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: MA_VOLATILE_MIN_STRENGTH },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of newSignals) {
        try {
          const positionState = await inspectActivePositionForSymbol(sig.symbol, maExchange);
          if (!positionState.inspectable) {
            console.warn(`[Run-MA_VOLATILE BG] ⚠️ Não foi possível inspecionar ${sig.symbol}: ${positionState.message}`);
            continue;
          }

          if (positionState.inspectable && !positionState.hasPosition) {
            const cleared = Number(
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${sig.symbol}
                  AND "strategyId" = ${maVolatileStrategy.id}
                  AND status = 'IN_PROGRESS'
              `
            );
            if (cleared > 0) {
              console.log(`[Run-MA_VOLATILE BG] 🧹 ${sig.symbol}: ${cleared} IN_PROGRESS sem posição real foram limpos`);
            }
          }

          if (positionState.hasPosition && positionState.direction === sig.direction) {
            console.log(`[Run-MA_VOLATILE BG] ⏭️ Já existe posição real em ${sig.symbol} (${positionState.direction}) — sinal ignorado`);
            continue;
          }

          if (positionState.hasPosition && positionState.direction !== sig.direction) {
            const closeResult = await closeActivePositionForSymbol(sig.symbol, maExchange);
            if (!closeResult.closed) {
              console.warn(`[Run-MA_VOLATILE BG] ⚠️ Não foi possível fechar posição oposta em ${sig.symbol}: ${closeResult.message}`);
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "Signal"
              SET status = 'EXPIRED'
              WHERE symbol = ${sig.symbol}
                AND "strategyId" = ${maVolatileStrategy.id}
                AND status = 'IN_PROGRESS'
            `;
            console.log(`[Run-MA_VOLATILE BG] 🔄 Posição oposta fechada em ${sig.symbol}: ${closeResult.message}`);
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
            extraInfo: sig.extraInfo,
            exchange: maExchange,
          });

          if (execResult.success && execResult.orderId) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
            console.log(`[Run-MA_VOLATILE BG] ✅ Auto-executado: ${sig.symbol} ${sig.direction} order ${execResult.orderId}`);
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
