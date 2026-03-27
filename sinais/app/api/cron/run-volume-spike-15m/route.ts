import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runVolumeSpike15mStrategy } from '@/lib/signalEngine';
import { fetchTopSymbolsBy24hPriceChange } from '@/lib/marketData';
import { update24hResults } from '@/lib/update24hResults';
import { executeSignalReal } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

interface StrategyData {
  id: string;
  displayName: string;
}

/**
 * Executa Volume Spike 15m em background.
 * 400 símbolos, timeframe 15m, 15 períodos. Sinais BUY e SELL com força >= 85.
 */
async function runVolumeSpike15mInBackground(
  strategy: StrategyData,
  params: Record<string, unknown>
): Promise<void> {
  const SYMBOLS = 400;
  const DELAY_MS = 200;
  const timeframe = '15m' as const;

  try {
    console.log(`[Volume Spike 15m BG] Iniciando processamento de ${SYMBOLS} símbolos (15m)...`);
    const symbols = await fetchTopSymbolsBy24hPriceChange(SYMBOLS, 100000);
    let signalsCreated = 0;

    for (const symbol of symbols) {
      try {
        const signalResult = await runVolumeSpike15mStrategy(symbol, timeframe, params);

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

            const autoMinStrength = getAutoExecuteMinStrength();
            const vsExchange = (params.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';
            if (signalResult.strength >= autoMinStrength) {
              console.log(`[Volume Spike 15m BG] 🚀 Auto-exec: ${symbol} força ${signalResult.strength} (>= ${autoMinStrength})`);
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
                  exchange: vsExchange,
                });
                if (result.success && result.orderId) {
                  await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${created.id}`;
                  console.log(`[Volume Spike 15m BG] ✅ Auto-executado: ${created.symbol} order ${result.orderId}`);
                } else {
                  console.warn(`[Volume Spike 15m BG] ⚠️ Auto-exec falhou ${created.symbol}: ${result.message}`);
                }
              } catch (err) {
                console.error(`[Volume Spike 15m BG] ❌ Erro auto-exec ${created.symbol}:`, err);
              }
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        console.error(`[Volume Spike 15m BG] Erro ${symbol}:`, error);
      }
    }

    const update24h = await update24hResults();
    console.log(
      `[Volume Spike 15m BG] Concluído: ${signalsCreated} sinais, 24h atualizados: ${update24h.updated}`
    );
  } catch (error) {
    console.error('[Volume Spike 15m BG] Erro fatal:', error);
  }
}

/**
 * Endpoint de cron dedicado para Volume Spike 15m.
 * Agendar a cada 15 min (ex.: :00, :15, :30, :45) no cron-job.org.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();

    const strategy = await prisma.strategy.findFirst({
      where: { name: 'VOLUME_SPIKE_15M' },
    });

    if (!strategy) {
      return NextResponse.json(
        { error: 'Estratégia VOLUME_SPIKE_15M não encontrada. Execute o seed do banco.' },
        { status: 404 }
      );
    }

    if (!strategy.isActive) {
      return NextResponse.json(
        { success: false, message: 'Estratégia 15MVolume está inativa' },
        { status: 400 }
      );
    }

    const params = JSON.parse(strategy.params || '{}') as Record<string, unknown>;

    runVolumeSpike15mInBackground(
      { id: strategy.id, displayName: strategy.displayName },
      params
    );

    return NextResponse.json({
      success: true,
      message: 'Processamento Volume Spike 15m iniciado em background (400 símbolos, 15m)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron Volume Spike 15m:', error);
    return NextResponse.json(
      {
        error: 'Erro ao executar cron Volume Spike 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
