import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { prisma } from '@/lib/db';
import {
  cleanupBybitOrphanOpenOrders,
  executeSignalReal,
  closeActivePositionForSymbol,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';

/**
 * Cron dedicado 15m: RSI_15M (reversal 28→32, universo MA30 −9%…−3% vs MA200 1h),
 * RSI_BYBIT_15M (mesma lógica SMA(RSI)×47 que o RSI 1h, velas 15m, universo MA30 > 9% vs MA200 1h),
 * MA_CROSS_15M, etc. Auto-exec com reversal close onde aplicável.
 */
async function runRsi15mInBackground(): Promise<void> {
  try {
    console.log('[Run-RSI-15m BG] Iniciando RSI 15m...');
    // Buffer de 5 min para garantir que sinais criados no início do runAllStrategies são capturados
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['RSI', 'VOLUME_SPIKE', 'MA_CROSS_5M', 'MA200_VOLATILE', 'MA_VOLATILE'],
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
          const positionState = await inspectActivePositionForSymbol(sig.symbol, rsiExchange);
          if (!positionState.inspectable) {
            console.warn(`[Run-RSI-15m BG] ⚠️ Não foi possível inspecionar ${sig.symbol}: ${positionState.message}`);
            continue;
          }

          if (positionState.inspectable && !positionState.hasPosition) {
            const cleared = Number(
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${sig.symbol}
                  AND "strategyId" = ${rsi15mStrategy.id}
                  AND status = 'IN_PROGRESS'
              `
            );
            if (cleared > 0) {
              console.log(`[Run-RSI-15m BG] 🧹 ${sig.symbol}: ${cleared} IN_PROGRESS sem posição real foram limpos`);
            }
          }

          if (positionState.hasPosition && positionState.direction === sig.direction) {
            console.log(`[Run-RSI-15m BG] ⏭️ Já existe posição real em ${sig.symbol} (${positionState.direction}) — sinal ignorado`);
            continue;
          }

          if (positionState.hasPosition && positionState.direction !== sig.direction) {
            const closeResult = await closeActivePositionForSymbol(sig.symbol, rsiExchange);
            if (!closeResult.closed) {
              console.warn(`[Run-RSI-15m BG] ⚠️ Não foi possível fechar posição oposta em ${sig.symbol}: ${closeResult.message}`);
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "Signal"
              SET status = 'EXPIRED'
              WHERE symbol = ${sig.symbol}
                AND "strategyId" = ${rsi15mStrategy.id}
                AND status = 'IN_PROGRESS'
            `;
            console.log(`[Run-RSI-15m BG] 🔄 Posição oposta fechada em ${sig.symbol}: ${closeResult.message}`);
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

    const rsiBybit15mStrategy = await prisma.strategy.findFirst({
      where: { name: 'RSI_BYBIT_15M', isActive: true },
    });

    if (rsiBybit15mStrategy) {
      const RSI_BYBIT_15M_MIN_STRENGTH = 60;
      const rbParams = JSON.parse(rsiBybit15mStrategy.params || '{}');
      const rbExchange = (rbParams.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

      const bybit15mSignals = await prisma.signal.findMany({
        where: {
          strategyId: rsiBybit15mStrategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: RSI_BYBIT_15M_MIN_STRENGTH },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of bybit15mSignals) {
        try {
          const positionState = await inspectActivePositionForSymbol(sig.symbol, rbExchange);
          if (!positionState.inspectable) {
            console.warn(
              `[Run-RSI-15m BG] ⚠️ RSI Bybit 15m: não foi possível inspecionar ${sig.symbol}: ${positionState.message}`
            );
            continue;
          }

          if (positionState.inspectable && !positionState.hasPosition) {
            const cleared = Number(
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${sig.symbol}
                  AND "strategyId" = ${rsiBybit15mStrategy.id}
                  AND status = 'IN_PROGRESS'
              `
            );
            if (cleared > 0) {
              console.log(`[Run-RSI-15m BG] 🧹 RSI Bybit 15m: ${sig.symbol}: ${cleared} IN_PROGRESS sem posição`);
            }
          }

          if (positionState.hasPosition && positionState.direction === sig.direction) {
            console.log(`[Run-RSI-15m BG] ⏭️ RSI Bybit 15m: já existe posição ${sig.direction} em ${sig.symbol}`);
            continue;
          }

          if (positionState.hasPosition && positionState.direction !== sig.direction) {
            const closeResult = await closeActivePositionForSymbol(sig.symbol, rbExchange);
            if (!closeResult.closed) {
              console.warn(
                `[Run-RSI-15m BG] ⚠️ RSI Bybit 15m: fechar oposta falhou ${sig.symbol}: ${closeResult.message}`
              );
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "Signal"
              SET status = 'EXPIRED'
              WHERE symbol = ${sig.symbol}
                AND "strategyId" = ${rsiBybit15mStrategy.id}
                AND status = 'IN_PROGRESS'
            `;
            console.log(`[Run-RSI-15m BG] 🔄 RSI Bybit 15m: posição oposta fechada ${sig.symbol}: ${closeResult.message}`);
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
            exchange: rbExchange,
          });

          if (execResult.success && execResult.orderId) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
            console.log(
              `[Run-RSI-15m BG] ✅ RSI Bybit 15m: auto-executado ${sig.symbol} ${sig.direction} order ${execResult.orderId}`
            );
          } else {
            console.warn(`[Run-RSI-15m BG] ⚠️ RSI Bybit 15m: auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-RSI-15m BG] ❌ RSI Bybit 15m: erro auto-exec ${sig.symbol}:`, err);
        }
      }
    }

    // Auto-exec MA_CROSS_15M — força mínima 70
    const maCross15mStrategy = await prisma.strategy.findFirst({
      where: { name: 'MA_CROSS_15M', isActive: true },
    });

    if (maCross15mStrategy) {
      const MA_CROSS_MIN_STRENGTH = 70;
      const maCrossParams   = JSON.parse(maCross15mStrategy.params || '{}');
      const maCrossExchange = (maCrossParams.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

      const maCrossSignals = await prisma.signal.findMany({
        where: {
          strategyId: maCross15mStrategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: MA_CROSS_MIN_STRENGTH },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of maCrossSignals) {
        try {
          const positionState = await inspectActivePositionForSymbol(sig.symbol, maCrossExchange);
          if (!positionState.inspectable) {
            console.warn(`[Run-RSI-15m BG] ⚠️ MA_CROSS: não foi possível inspecionar ${sig.symbol}: ${positionState.message}`);
            continue;
          }

          if (positionState.inspectable && !positionState.hasPosition) {
            const cleared = Number(
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${sig.symbol}
                  AND "strategyId" = ${maCross15mStrategy.id}
                  AND status = 'IN_PROGRESS'
              `
            );
            if (cleared > 0) {
              console.log(`[Run-RSI-15m BG] 🧹 MA_CROSS: ${sig.symbol} limpou ${cleared} IN_PROGRESS sem posição real`);
            }
          }

          if (positionState.hasPosition && positionState.direction === sig.direction) {
            console.log(`[Run-RSI-15m BG] ⏭️ MA_CROSS: já existe posição real em ${sig.symbol} (${positionState.direction}) — sinal ignorado`);
            continue;
          }

          if (positionState.hasPosition && positionState.direction !== sig.direction) {
            const closeResult = await closeActivePositionForSymbol(sig.symbol, maCrossExchange);
            if (!closeResult.closed) {
              console.warn(`[Run-RSI-15m BG] ⚠️ MA_CROSS: não foi possível fechar posição oposta em ${sig.symbol}: ${closeResult.message}`);
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "Signal"
              SET status = 'EXPIRED'
              WHERE symbol = ${sig.symbol}
                AND "strategyId" = ${maCross15mStrategy.id}
                AND status = 'IN_PROGRESS'
            `;
            console.log(`[Run-RSI-15m BG] 🔄 MA_CROSS: posição oposta fechada em ${sig.symbol}: ${closeResult.message}`);
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
            exchange: maCrossExchange,
          });

          if (execResult.success && execResult.orderId) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
            console.log(`[Run-RSI-15m BG] ✅ MA_CROSS: auto-executado ${sig.symbol} ${sig.direction} order ${execResult.orderId}`);
          } else {
            console.warn(`[Run-RSI-15m BG] ⚠️ MA_CROSS: auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-RSI-15m BG] ❌ MA_CROSS: erro auto-exec ${sig.symbol}:`, err);
        }
      }
    }

    const orphanCleanup = await cleanupBybitOrphanOpenOrders();
    if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
      console.log(
        `[Run-RSI-15m BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
          (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
      );
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
      message:
        'Processamento em background (RSI_15M + RSI_BYBIT_15M + MA_CROSS_15M; crons 15m)',
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
