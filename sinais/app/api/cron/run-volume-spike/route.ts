import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runVolumeSpikeStrategy } from '@/lib/signalEngine';
import { fetchTopSymbolsBy24hPriceChange } from '@/lib/marketData';
import { update24hResults } from '@/lib/update24hResults';
import { executeSignalReal } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

/** Estratégia para passar ao background */
interface StrategyData {
  id: string;
  displayName: string;
}

/**
 * Executa Volume Spike em background (fire-and-forget).
 * 400 símbolos, sinais BUY e SELL. Resposta imediata.
 */
async function runVolumeSpikeInBackground(
  strategy: StrategyData,
  params: Record<string, unknown>
): Promise<void> {
  const SYMBOLS = 400;
  const DELAY_MS = 200;

  try {
    console.log(`[Volume Spike BG] Iniciando processamento de ${SYMBOLS} símbolos...`);
    const symbols = await fetchTopSymbolsBy24hPriceChange(SYMBOLS, 100000);
    const timeframe = '1h' as const;
    let signalsCreated = 0;

    for (const symbol of symbols) {
      try {
        const signalResult = await runVolumeSpikeStrategy(symbol, timeframe, params);

        // Sinais de compra e venda com força >= 85
        if (signalResult && signalResult.strength >= 85) {
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const existingSignal = await prisma.signal.findFirst({
            where: {
              symbol,
              strategyId: strategy.id,
              timeframe,
              direction: signalResult.direction,
              generatedAt: { gte: twoHoursAgo },
            },
          });

          if (!existingSignal) {
            const created = await prisma.signal.create({
              data: {
                symbol,
                direction: signalResult.direction,
                timeframe,
                strategyId: strategy.id,
                strategyName: strategy.displayName,
                entryPrice: signalResult.entryPrice,
                stopLoss: signalResult.stopLoss,
                target1: signalResult.target1,
                target2: signalResult.target2,
                target3: signalResult.target3,
                strength: signalResult.strength,
                status: 'NEW',
                extraInfo: signalResult.extraInfo,
              },
            });
            signalsCreated++;

            // Execução automática: força >= AUTO_EXECUTE_MIN_STRENGTH (default 80)
            // Awaited para que a ordem seja enviada antes do processo terminar (serverless)
            const autoMinStrength = getAutoExecuteMinStrength();
            if (signalResult.strength >= autoMinStrength) {
              console.log(`[Volume Spike BG] 🚀 Auto-exec: ${symbol} força ${signalResult.strength} (>= ${autoMinStrength})`);
              try {
                const result = await executeSignalReal({
                  id: created.id,
                  symbol: created.symbol,
                  direction: created.direction as 'BUY' | 'SELL',
                  entryPrice: created.entryPrice,
                  stopLoss: created.stopLoss,
                  target1: created.target1,
                  target2: created.target2,
                  target3: created.target3 ?? null,
                  strength: created.strength,
                  strategyName: created.strategyName,
                  status: created.status,
                });
                if (result.success && result.orderId) {
                  await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${created.id}`;
                  console.log(`[Volume Spike BG] ✅ Auto-executado: ${created.symbol} order ${result.orderId}`);
                } else {
                  console.warn(`[Volume Spike BG] ⚠️ Auto-exec falhou ${created.symbol}: ${result.message}`);
                }
              } catch (err) {
                console.error(`[Volume Spike BG] ❌ Erro auto-exec ${created.symbol}:`, err);
              }
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        console.error(`[Volume Spike BG] Erro ${symbol}:`, error);
      }
    }

    const update24h = await update24hResults();
    console.log(
      `[Volume Spike BG] Concluído: ${signalsCreated} sinais, 24h atualizados: ${update24h.updated}`
    );
  } catch (error) {
    console.error('[Volume Spike BG] Erro fatal:', error);
  }
}

/**
 * Endpoint de cron dedicado para Volume Spike
 * Resposta imediata - 400 símbolos, compra e venda
 * Evita timeout 30s do cron-job.org
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

    const strategy = await prisma.strategy.findFirst({
      where: { name: 'VOLUME_SPIKE' },
    });

    if (!strategy) {
      return NextResponse.json(
        { error: 'Estratégia VOLUME_SPIKE não encontrada. Execute o seed do banco.' },
        { status: 404 }
      );
    }

    if (!strategy.isActive) {
      return NextResponse.json(
        { success: false, message: 'Estratégia VOLUME_SPIKE está inativa' },
        { status: 400 }
      );
    }

    const params = JSON.parse(strategy.params || '{}') as Record<string, unknown>;

    // Fire-and-forget: inicia em background, responde imediatamente
    runVolumeSpikeInBackground(
      { id: strategy.id, displayName: strategy.displayName },
      params
    );

    return NextResponse.json({
      success: true,
      message: 'Processamento Volume Spike iniciado em background (400 símbolos, compra e venda)',
      executedAt: now.toISOString(),
      nextExecution: `${(hour + 1) % 24}:00`,
    });
  } catch (error) {
    console.error('Erro no cron Volume Spike:', error);
    return NextResponse.json(
      {
        error: 'Erro ao executar cron Volume Spike',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
