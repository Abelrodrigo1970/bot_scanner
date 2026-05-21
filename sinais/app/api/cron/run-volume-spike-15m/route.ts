import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 } from '@/lib/symbolUniverseDefaults';
import { resolveUniverseScanSymbols } from '@/lib/universeScanPersistence';
import {
  MA_CROSS_5M_SIGNAL_COOLDOWN_MS,
  runMaCross15mStrategy,
  shouldCloseMaCross5mByDiff,
  strategyAllowsAutoExecuteDirection,
  type StrategyParams,
} from '@/lib/signalEngine';
import { update24hResults } from '@/lib/update24hResults';
import {
  cleanupBybitOrphanOpenOrders,
  closeActivePositionForSymbol,
  executeSignalReal,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

interface StrategyData {
  id: string;
  displayName: string;
}

const TIMEFRAME_15M = '15m' as const;
const MA_CROSS_5M_MIN_STRENGTH = 70;

/**
 * MA Cross 15m (MA12/MA30) em background.
 * Cálculo em velas 15m; agendamento típico a cada 15 min (ex.: :00, :15, :30, :45).
 * Universo: Scanner 1 — último scan `UNIVERSE_ABOVE_MA200_1H` (fecho 0–10% acima SMA200 em 1h).
 * Não cria novo sinal se já existir posição real no mesmo sentido (um trade por símbolo até fechar).
 * Cooldown: no máximo um sinal por símbolo/direção a cada 8 h (ver `MA_CROSS_5M_SIGNAL_COOLDOWN_MS`).
 */
async function runMaCross5mInBackground(
  strategy: StrategyData,
  params: StrategyParams
): Promise<void> {
  const DELAY_MS = 200;

  try {
    const symbols = await resolveUniverseScanSymbols(UNIVERSE_CODE_SCANNER_1_ABOVE_MA200);
    if (symbols.length === 0) {
      console.warn(
        '[MA Cross 15m BG] Scanner 1 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1.'
      );
    }
    console.log(`[MA Cross 15m BG] Iniciando ${symbols.length} símbolos (15m)…`);
    let signalsCreated = 0;
    const ex = (params.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

    for (const symbol of symbols) {
      try {
        const closeCheck = await shouldCloseMaCross5mByDiff(symbol, TIMEFRAME_15M, params);
        if (closeCheck.shouldClose) {
          const positionState = await inspectActivePositionForSymbol(symbol, ex);
          if (positionState.inspectable && positionState.hasPosition) {
            const closeResult = await closeActivePositionForSymbol(symbol, ex);
            if (closeResult.closed) {
              await prisma.$executeRaw`
                UPDATE "Signal"
                SET status = 'EXPIRED'
                WHERE symbol = ${symbol}
                  AND "strategyId" = ${strategy.id}
                  AND status = 'IN_PROGRESS'
              `;
              console.log(
                `[MA Cross 15m BG] 🟨 Fecho por compressão MA12/MA30 (${(closeCheck.currentDiffPct ?? 0).toFixed(3)}%): ${symbol}`
              );
            }
          }
        }

        const signalResult = await runMaCross15mStrategy(symbol, TIMEFRAME_15M, params);

        if (signalResult && signalResult.strength >= MA_CROSS_5M_MIN_STRENGTH) {
          const posGate = await inspectActivePositionForSymbol(symbol, ex);
          if (
            posGate.inspectable &&
            posGate.hasPosition &&
            posGate.direction === signalResult.direction
          ) {
            continue;
          }

          const cooldownSince = new Date(Date.now() - MA_CROSS_5M_SIGNAL_COOLDOWN_MS);
          const existingSignal = await prisma.signal.findFirst({
            where: {
              symbol,
              strategyId: strategy.id,
              timeframe: TIMEFRAME_15M,
              direction: signalResult.direction,
              generatedAt: { gte: cooldownSince },
            },
          });

          if (!existingSignal) {
            const created = await prisma.signal.create({
              data: {
                symbol,
                direction: signalResult.direction,
                timeframe: TIMEFRAME_15M,
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
            if (
              signalResult.strength >= autoMinStrength &&
              strategyAllowsAutoExecuteDirection(signalResult.direction, params)
            ) {
              console.log(`[MA Cross 15m BG] Auto-exec: ${symbol} força ${signalResult.strength} (>= ${autoMinStrength})`);
              try {
                const positionState = await inspectActivePositionForSymbol(created.symbol, ex);
                if (!positionState.inspectable) {
                  console.warn(`[MA Cross 15m BG] ⚠️ Não foi possível inspecionar ${created.symbol}: ${positionState.message}`);
                  continue;
                }

                if (positionState.hasPosition && positionState.direction === created.direction) {
                  console.log(`[MA Cross 15m BG] ⏭️ Já existe posição real em ${created.symbol} (${positionState.direction}) — sinal ignorado`);
                  continue;
                }

                if (positionState.hasPosition && positionState.direction !== created.direction) {
                  const closeResult = await closeActivePositionForSymbol(created.symbol, ex);
                  if (!closeResult.closed) {
                    console.warn(`[MA Cross 15m BG] ⚠️ Não foi possível fechar posição oposta em ${created.symbol}: ${closeResult.message}`);
                    continue;
                  }

                  await prisma.$executeRaw`
                    UPDATE "Signal"
                    SET status = 'EXPIRED'
                    WHERE symbol = ${created.symbol}
                      AND "strategyId" = ${strategy.id}
                      AND status = 'IN_PROGRESS'
                  `;
                  console.log(`[MA Cross 15m BG] 🔄 Posição oposta fechada em ${created.symbol}: ${closeResult.message}`);
                }

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
                  console.log(`[MA Cross 15m BG] Auto-executado: ${created.symbol} order ${result.orderId}`);
                } else {
                  console.warn(`[MA Cross 15m BG] Auto-exec falhou ${created.symbol}: ${result.message}`);
                }
              } catch (err) {
                console.error(`[MA Cross 15m BG] Erro auto-exec ${created.symbol}:`, err);
              }
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        console.error(`[MA Cross 15m BG] Erro ${symbol}:`, error);
      }
    }

    const update24h = await update24hResults();
    const orphanCleanup = await cleanupBybitOrphanOpenOrders();
    if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
      console.log(
        `[MA Cross 15m BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
          (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
      );
    }
    console.log(
      `[MA Cross 15m BG] Concluído: ${signalsCreated} sinais, 24h atualizados: ${update24h.updated}`
    );
  } catch (error) {
    console.error('[MA Cross 15m BG] Erro fatal:', error);
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
        { success: false, message: 'Estratégia MA Cross 15m está inactiva' },
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
      message: 'MA Cross 15m iniciado em background (universo: scan Bybit Volume 1h >500k e MA200 1h)',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron MA Cross 15m:', error);
    return NextResponse.json(
      {
        error: 'Erro ao executar cron MA Cross 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
