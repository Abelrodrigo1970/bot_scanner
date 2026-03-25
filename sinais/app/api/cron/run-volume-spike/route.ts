import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runVolumeSpikeStrategy } from '@/lib/signalEngine';
import { fetchTopSymbolsBy24hPriceChange } from '@/lib/marketData';
import { update24hResults } from '@/lib/update24hResults';

/** Estratégia para passar ao background */
interface StrategyData {
  id: string;
  displayName: string;
}

/**
 * Executa Volume Spike 1h em background (fire-and-forget).
 * 400 símbolos, sinais BUY e SELL. Sem auto-exec de ordens.
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
            await prisma.signal.create({
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
            console.log(`[Volume Spike BG] ✅ Sinal criado: ${symbol} ${signalResult.direction}`);
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
 * Endpoint de cron dedicado para Volume Spike 1h.
 * Gera sinais apenas - sem auto-exec de ordens.
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
