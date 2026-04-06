import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';
import { prisma } from '@/lib/db';
import { executeSignalReal, closeActivePositionForSymbol } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/**
 * Executa sinais de 1h em background (fire-and-forget):
 * RSI + MA200_VOLATILE. Auto-executa ordens apenas para MA200_VOLATILE.
 * Volume Spike 1h tem cron separado: /api/cron/run-volume-spike
 */
async function runSignalsInBackground(hour: number, minute: number): Promise<void> {
  try {
    console.log('[Run-Signals BG] Iniciando estratégias 1h (RSI + MA200)...');
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);

    const signalsCreated = await runAllStrategies({
      exclude: ['VOLUME_SPIKE', 'VOLUME_SPIKE_15M', 'MA_VOLATILE'],
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
          const existingActive = await prisma.signal.findFirst({
            where: {
              symbol: sig.symbol,
              status: 'IN_PROGRESS',
              strategyId: rsiStrategy.id,
            },
          });
          if (existingActive) {
            console.log(`[Run-Signals BG] ⏭️ RSI: já existe posição ativa em ${sig.symbol} (${existingActive.direction}) — sinal ignorado`);
            continue;
          }

          const closeResult = await closeActivePositionForSymbol(sig.symbol, rsiExchange);
          if (closeResult.closed) {
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
          // Proteção: não abrir nova posição se já existe IN_PROGRESS no mesmo símbolo
          const existingActive = await prisma.signal.findFirst({
            where: {
              symbol: sig.symbol,
              status: 'IN_PROGRESS',
              strategyId: ma200Strategy.id,
            },
          });
          if (existingActive) {
            console.log(`[Run-Signals BG] ⏭️ Já existe posição ativa em ${sig.symbol} (${existingActive.direction}) — sinal ignorado`);
            continue;
          }

          const closeResult = await closeActivePositionForSymbol(sig.symbol, ma200Exchange);
          if (closeResult.closed) {
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
