import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies, strategyAllowsAutoExecuteDirection } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';
import { prisma } from '@/lib/db';
import {
  cleanupBybitOrphanOpenOrders,
  executeSignalReal,
  closeActivePositionForSymbol,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/**
 * Executa sinais em background (fire-and-forget):
 * MA200_VOLATILE 4h e restantes estratégias 1h activas na BD.
 * RSI 1h, Volume Spike 1h, MA_CROSS_15M e RSI 15m foram removidas.
 * Auto-executa ordens: MA200_VOLATILE.
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando estratégias 1h (MA200 4h, …)...');
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['MA_CROSS_5M', 'EMA_SCALPING_SELL', 'AFASTAMENTO_MEDIO_30M'],
    });

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

          if (!strategyAllowsAutoExecuteDirection(sig.direction as 'BUY' | 'SELL', ma200Params)) {
            console.log(
              `[Run-Signals BG] ⏭️ Auto-exec ${sig.direction} desactivada (allowBuy/allowSell) — sinal mantido: ${sig.symbol}`
            );
            continue;
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
 * Endpoint de cron para MA200 4h e restantes estratégias 1h activas.
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
      message: 'Processamento iniciado em background (MA200 4h e estratégias 1h activas)',
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
