import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runMaCross5mStrategy, type StrategyParams } from '@/lib/signalEngine';
import { update24hResults } from '@/lib/update24hResults';
import { executeSignalReal } from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

interface StrategyData {
  id: string;
  displayName: string;
}

const TIMEFRAME_5M = '5m' as const;
const MA_CROSS_5M_MIN_STRENGTH = 70;

/**
 * MA Cross 5m (MA30/MA200) em background.
 * Cálculo em velas 5m; agendamento típico a cada 15 min (ex.: :00, :15, :30, :45).
 * Universo: tabela `Ma30Above6Pct` (menu MA30 > 6% MA200, velas 1h no scan).
 */
async function runMaCross5mInBackground(
  strategy: StrategyData,
  params: StrategyParams
): Promise<void> {
  const DELAY_MS = 200;

  try {
    const maRows = await prisma.ma30Above6Pct.findMany({ orderBy: { rank: 'asc' } });
    if (maRows.length === 0) {
      console.warn(
        '[MA Cross 5m BG] Nenhum símbolo no scan MA30>6% MA200. Atualize a página "MA30 > 6% MA200".'
      );
    }

    const symbols = maRows.map((r) => r.symbol);
    console.log(`[MA Cross 5m BG] Iniciando ${symbols.length} símbolos (5m)…`);
    let signalsCreated = 0;

    for (const symbol of symbols) {
      try {
        const signalResult = await runMaCross5mStrategy(symbol, TIMEFRAME_5M, params);

        if (signalResult && signalResult.strength >= MA_CROSS_5M_MIN_STRENGTH) {
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const existingSignal = await prisma.signal.findFirst({
            where: {
              symbol,
              strategyId: strategy.id,
              timeframe: TIMEFRAME_5M,
              direction: signalResult.direction,
              generatedAt: { gte: twoHoursAgo },
            },
          });

          if (!existingSignal) {
            const created = await prisma.signal.create({
              data: {
                symbol,
                direction: signalResult.direction,
                timeframe: TIMEFRAME_5M,
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
            const ex = (params.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';
            if (signalResult.strength >= autoMinStrength) {
              console.log(`[MA Cross 5m BG] Auto-exec: ${symbol} força ${signalResult.strength} (>= ${autoMinStrength})`);
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
                  extraInfo: created.extraInfo,
                  exchange: ex,
                });
                if (result.success && result.orderId) {
                  await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${created.id}`;
                  console.log(`[MA Cross 5m BG] Auto-executado: ${created.symbol} order ${result.orderId}`);
                } else {
                  console.warn(`[MA Cross 5m BG] Auto-exec falhou ${created.symbol}: ${result.message}`);
                }
              } catch (err) {
                console.error(`[MA Cross 5m BG] Erro auto-exec ${created.symbol}:`, err);
              }
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        console.error(`[MA Cross 5m BG] Erro ${symbol}:`, error);
      }
    }

    const update24h = await update24hResults();
    console.log(
      `[MA Cross 5m BG] Concluído: ${signalsCreated} sinais, 24h atualizados: ${update24h.updated}`
    );
  } catch (error) {
    console.error('[MA Cross 5m BG] Erro fatal:', error);
  }
}

/**
 * Endpoint agendado a cada 15 min.
 * (URL legada `run-volume-spike-15m` mantida para o cron / run-15m agregado.)
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
      where: { name: 'MA_CROSS_5M' },
    });

    if (!strategy) {
      return NextResponse.json(
        { error: 'Estratégia MA_CROSS_5M não encontrada. Execute o seed do banco.' },
        { status: 404 }
      );
    }

    if (!strategy.isActive) {
      return NextResponse.json(
        { success: false, message: 'Estratégia MA Cross 5m está inactiva' },
        { status: 400 }
      );
    }

    const params = JSON.parse(strategy.params || '{}') as StrategyParams;

    runMaCross5mInBackground(
      { id: strategy.id, displayName: strategy.displayName },
      params
    );

    return NextResponse.json({
      success: true,
      message: 'MA Cross 5m iniciado em background (universo: scan MA30>6% MA200)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron MA Cross 5m:', error);
    return NextResponse.json(
      {
        error: 'Erro ao executar cron MA Cross 5m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
