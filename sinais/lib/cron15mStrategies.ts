import { prisma } from '@/lib/db';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 } from '@/lib/symbolUniverseDefaults';
import { resolveUniverseScanSymbols } from '@/lib/universeScanPersistence';
import {
  runAllStrategies,
  runMaCross15mStrategy,
  shouldCloseMaCross5mByDiff,
  strategyAllowsAutoExecuteDirection,
  type StrategyParams,
} from '@/lib/signalEngine';
import {
  checkMaCross15mSignalGate,
  isMaCross15mHourBlocked,
  isMaCross15mWeekendBlocked,
} from '@/lib/maCross15mGuard';
import { update24hResults } from '@/lib/update24hResults';
import {
  cleanupBybitOrphanOpenOrders,
  closeActivePositionForSymbol,
  executeSignalReal,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';

const TIMEFRAME_15M = '15m' as const;
const MA_CROSS_5M_MIN_STRENGTH = 70;

interface StrategyData {
  id: string;
  displayName: string;
}

export type Cron15mStatus =
  | 'done'
  | 'not-found'
  | 'inactive'
  | 'skipped-weekend'
  | 'skipped-hour';

export interface Cron15mResult {
  status: Cron15mStatus;
  signalsCreated?: number;
}

/**
 * MA Cross 15m (MA12/MA30). Cálculo em velas 15m.
 * Universo: Scanner 1 — último scan `UNIVERSE_ABOVE_MA200_1H`.
 * Não cria novo sinal se já existir posição real no mesmo sentido.
 * Cooldown 24h entre dias; máx. 2/dia (2.º só se 1.º verde); sem FDS; horas bloqueadas via guard.
 */
async function runMaCross15mWorker(
  strategy: StrategyData,
  params: StrategyParams
): Promise<number> {
  const DELAY_MS = 200;
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

        const gate = await checkMaCross15mSignalGate(prisma, {
          symbol,
          strategyId: strategy.id,
          direction: signalResult.direction,
        });

        if (gate.allowed) {
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
        } else {
          console.log(`[MA Cross 15m BG] ⏭️ ${symbol}: ${gate.reason}`);
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
  return signalsCreated;
}

/**
 * Pipeline completa da MA Cross 15m (gating de horário/FDS + execução).
 * Prioridade 1 do agregado 15m. Awaitable (corre inline; sem timeout HTTP).
 */
export async function runMaCross15mPipeline(now: Date = new Date()): Promise<Cron15mResult> {
  const strategy = await prisma.strategy.findFirst({ where: { name: 'MA_CROSS_5M' } });
  if (!strategy) {
    console.warn('[MA Cross 15m] Estratégia MA_CROSS_5M não encontrada (correr o seed).');
    return { status: 'not-found' };
  }
  if (!strategy.isActive) {
    console.log('[MA Cross 15m] Estratégia inactiva — saltada.');
    return { status: 'inactive' };
  }
  if (isMaCross15mWeekendBlocked(now)) {
    console.log('[MA Cross 15m] Fim-de-semana (PT) — saltada.');
    return { status: 'skipped-weekend' };
  }
  if (isMaCross15mHourBlocked(now)) {
    const h = now.toLocaleString('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false });
    console.log(`[MA Cross 15m] Horário ${h}h PT bloqueado — saltada.`);
    return { status: 'skipped-hour' };
  }

  const params = JSON.parse(strategy.params || '{}') as StrategyParams;
  const signalsCreated = await runMaCross15mWorker(
    { id: strategy.id, displayName: strategy.displayName },
    params
  );
  return { status: 'done', signalsCreated };
}

/**
 * Pipeline da EMA Ribbon Scalping BUY 15m (tendência de alta + retração). Prioridade 2 do agregado 15m.
 */
export async function runEmaRibbonBuy15mPipeline(): Promise<number> {
  console.log('[Run-15m-strategies BG] Iniciando EMA Ribbon BUY 15m (tendência alta + retração)...');
  const signalsCreated = await runAllStrategies({ only: ['EMA_SCALPING'] });

  const orphanCleanup = await cleanupBybitOrphanOpenOrders();
  if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
    console.log(
      `[Run-15m-strategies BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
        (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
    );
  }

  console.log(`[Run-15m-strategies BG] Concluído: ${signalsCreated} sinais criados`);
  return signalsCreated;
}
