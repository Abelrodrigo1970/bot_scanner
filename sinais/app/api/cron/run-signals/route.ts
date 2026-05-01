import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';
import { prisma } from '@/lib/db';
import {
  executeSignalReal,
  closeActivePositionForSymbol,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/**
 * Executa sinais em background (fire-and-forget):
 * RSI 1h + MA200_VOLATILE 4h + MA_CROSS_1H (MA12/MA30 em 1h, universo BybitAboveMa200Mc20m), conforme estratégias ativas na BD.
 * Exclui: RSI_15M, VOLUME_SPIKE, MA_CROSS_5M, MA_VOLATILE (têm cron dedicado).
 * Auto-executa ordens: RSI e MA200_VOLATILE (não MA_CROSS_1H por defeito).
 * Volume Spike 1h: /api/cron/run-volume-spike. MA Cross 5m/15m: /api/cron/run-volume-spike-15m
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando estratégias (RSI 1h + MA200 4h + MA_CROSS_1H se ativo, …)...');
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['RSI_15M', 'VOLUME_SPIKE', 'MA_CROSS_5M', 'MA_VOLATILE'],
    });

    // Auto-exec RSI 1h — força mínima 60
    const rsiStrategy = await prisma.strategy.findFirst({
      where: { name: 'RSI', isActive: true },
    });

    if (rsiStrategy) {
      const RSI_MIN_STRENGTH = 60;
      const rsiParams = JSON.parse(rsiStrategy.params || '{}');
      const rsiExchange = (rsiParams.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

      const rsiSignals = await prisma.signal.findMany({
        where: {
          strategyId: rsiStrategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: RSI_MIN_STRENGTH },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of rsiSignals) {
        try {
          const positionState = await inspectActivePositionForSymbol(sig.symbol, rsiExchange);
          if (!positionState.inspectable) {
            console.warn(`[Run-Signals BG] ⚠️ RSI: não foi possível inspecionar ${sig.symbol}: ${positionState.message}`);
            continue;
          }

          if (positionState.inspectable && !positionState.hasPosition) {
            const cleared = Number(
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${sig.symbol}
                  AND "strategyId" = ${rsiStrategy.id}
                  AND status = 'IN_PROGRESS'
              `
            );
            if (cleared > 0) {
              console.log(`[Run-Signals BG] 🧹 RSI: ${sig.symbol} limpou ${cleared} IN_PROGRESS sem posição real`);
            }
          }

          if (positionState.hasPosition && positionState.direction === sig.direction) {
            console.log(`[Run-Signals BG] ⏭️ RSI: já existe posição real em ${sig.symbol} (${positionState.direction}) — sinal ignorado`);
            continue;
          }

          if (positionState.hasPosition && positionState.direction !== sig.direction) {
            const closeResult = await closeActivePositionForSymbol(sig.symbol, rsiExchange);
            if (!closeResult.closed) {
              console.warn(`[Run-Signals BG] ⚠️ RSI: não foi possível fechar posição oposta em ${sig.symbol}: ${closeResult.message}`);
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "Signal"
              SET status = 'EXPIRED'
              WHERE symbol = ${sig.symbol}
                AND "strategyId" = ${rsiStrategy.id}
                AND status = 'IN_PROGRESS'
            `;
            console.log(`[Run-Signals BG] 🔄 RSI: posição oposta fechada em ${sig.symbol}: ${closeResult.message}`);
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
            console.log(`[Run-Signals BG] ✅ RSI: auto-executado ${sig.symbol} ${sig.direction} order ${execResult.orderId}`);
          } else {
            console.warn(`[Run-Signals BG] ⚠️ RSI: auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-Signals BG] ❌ RSI: erro auto-exec ${sig.symbol}:`, err);
        }
      }
    }

    // Auto-exec MA200_VOLATILE — força mínima 70 (igual à força fixa dos sinais MA200)
    const ma200Strategy = await prisma.strategy.findFirst({
      where: { name: 'MA200_VOLATILE', isActive: true },
    });

    if (ma200Strategy) {
      const MA200_MIN_STRENGTH = 70;
      const ma200Params = JSON.parse(ma200Strategy.params || '{}');
      const ma200Exchange = (ma200Params.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';
      const ma200CloseAfterHours = Number(ma200Params.closeAfterHours ?? 24);

      const newSignals = await prisma.signal.findMany({
        where: {
          strategyId: ma200Strategy.id,
          status: 'NEW',
          generatedAt: { gte: startedAt },
          strength: { gte: MA200_MIN_STRENGTH },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of newSignals) {
        try {
          const positionState = await inspectActivePositionForSymbol(sig.symbol, ma200Exchange);
          if (!positionState.inspectable) {
            console.warn(`[Run-Signals BG] ⚠️ MA200: não foi possível inspecionar ${sig.symbol}: ${positionState.message}`);
            continue;
          }

          if (positionState.inspectable && !positionState.hasPosition) {
            const cleared = Number(
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${sig.symbol}
                  AND "strategyId" = ${ma200Strategy.id}
                  AND status = 'IN_PROGRESS'
              `
            );
            if (cleared > 0) {
              console.log(`[Run-Signals BG] 🧹 MA200: ${sig.symbol} limpou ${cleared} IN_PROGRESS sem posição real`);
            }
          }

          if (positionState.hasPosition && positionState.direction === sig.direction) {
            console.log(`[Run-Signals BG] ⏭️ Já existe posição real em ${sig.symbol} (${positionState.direction}) — sinal ignorado`);
            continue;
          }

          if (positionState.hasPosition && positionState.direction !== sig.direction) {
            const closeResult = await closeActivePositionForSymbol(sig.symbol, ma200Exchange);
            if (!closeResult.closed) {
              console.warn(`[Run-Signals BG] ⚠️ MA200: não foi possível fechar posição oposta em ${sig.symbol}: ${closeResult.message}`);
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "Signal"
              SET status = 'EXPIRED'
              WHERE symbol = ${sig.symbol}
                AND "strategyId" = ${ma200Strategy.id}
                AND status = 'IN_PROGRESS'
            `;
            console.log(`[Run-Signals BG] 🔄 Posição oposta fechada em ${sig.symbol}: ${closeResult.message}`);
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
            exchange: ma200Exchange,
          });

          if (execResult.success && execResult.orderId) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
            console.log(`[Run-Signals BG] ✅ Auto-executado: ${sig.symbol} ${sig.direction} (MA200) order ${execResult.orderId}`);
          } else {
            console.warn(`[Run-Signals BG] ⚠️ Auto-exec falhou ${sig.symbol}: ${execResult.message}`);
          }
        } catch (err) {
          console.error(`[Run-Signals BG] ❌ Erro auto-exec ${sig.symbol}:`, err);
        }
      }

      const ma200Cutoff = new Date(Date.now() - ma200CloseAfterHours * 60 * 60 * 1000);
      const expiringSignals = await prisma.signal.findMany({
        where: {
          strategyId: ma200Strategy.id,
          status: 'IN_PROGRESS',
          generatedAt: { lte: ma200Cutoff },
        },
        orderBy: { generatedAt: 'asc' },
      });

      for (const sig of expiringSignals) {
        try {
          const positionState = await inspectActivePositionForSymbol(sig.symbol, ma200Exchange);
          if (!positionState.inspectable) {
            console.warn(`[Run-Signals BG] ⚠️ MA200 24h: não foi possível inspecionar ${sig.symbol}: ${positionState.message}`);
            continue;
          }

          if (!positionState.hasPosition) {
            await prisma.$executeRaw`UPDATE "Signal" SET status = 'EXPIRED' WHERE id = ${sig.id}`;
            console.log(`[Run-Signals BG] 🧹 MA200 24h: ${sig.symbol} sem posição real, sinal expirado`);
            continue;
          }

          const closeResult = await closeActivePositionForSymbol(sig.symbol, ma200Exchange);
          if (!closeResult.closed) {
            console.warn(`[Run-Signals BG] ⚠️ MA200 24h: não foi possível fechar ${sig.symbol}: ${closeResult.message}`);
            continue;
          }

          await prisma.$executeRaw`UPDATE "Signal" SET status = 'EXPIRED' WHERE id = ${sig.id}`;
          console.log(`[Run-Signals BG] ⏰ MA200 24h: posição fechada em ${sig.symbol}`);
        } catch (err) {
          console.error(`[Run-Signals BG] ❌ MA200 24h: erro ao fechar ${sig.symbol}:`, err);
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
 * Endpoint de cron para RSI 1h + MA200 4h.
 * MA Cross 5m: cron dedicado (url legada /api/cron/run-volume-spike-15m, a cada 15 min).
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

    runSignalsInBackground(hour, minute);

    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (RSI 1h + MA200 4h + MA Cross 1h MA12/30 se estratégia ativa)',
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
