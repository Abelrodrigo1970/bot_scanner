import { prisma } from '@/lib/db';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 } from '@/lib/symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from '@/lib/universeScanPersistence';
import {
  runAllStrategies,
  runMaCross15mStrategy,
  strategyAllowsAutoExecuteDirection,
  type StrategyParams,
} from '@/lib/signalEngine';
import {
  checkMaCross15mSignalGate,
  isMaCross15mHourBlocked,
  MA_CROSS_15M_MIN_TURNOVER_1H_USD,
} from '@/lib/maCross15mGuard';
import {
  isPivotBossBear15mHourBlocked,
  isPivotBossBear15mWeekendBlocked,
} from '@/lib/pivotBossGuard';
import { update24hResults } from '@/lib/update24hResults';
import {
  cleanupBybitOrphanOpenOrders,
  executeSignalReal,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';
import { runScanner3Rsi15mScan, type Scanner3ScanResult } from '@/lib/scanner3UniverseScan';

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
 * Universo: Scanner 1 top 20 — último scan `UNIVERSE_ABOVE_MA200_1H`.
 * Cooldown 24h entre dias; máx. 2/dia (2.º só se 1.º verde); activo sáb/dom.
 */
async function runMaCross15mWorker(
  strategy: StrategyData,
  params: StrategyParams
): Promise<number> {
  const DELAY_MS = 200;
  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? 20)));
  const minTurnover3hUsd = Math.max(
    0,
    Number(params.minTurnover3hUsd ?? MA_CROSS_15M_MIN_TURNOVER_1H_USD)
  );
  const symbols = await resolveUniverseScanSymbolsTopN(
    UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
    topN
  );
  if (symbols.length === 0) {
    console.warn(
      '[MA Cross 15m BG] Scanner 1 vazio. Corra /api/cron/run-universe-scans ou Origem de dados → Scanner 1.'
    );
  }
  console.log(`[MA Cross 15m BG] Iniciando ${symbols.length} símbolos (Scanner 1 top ${topN})…`);
  let signalsCreated = 0;
  const ex = (params.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

  for (const symbol of symbols) {
    try {
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
          minTurnover3hUsd,
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
                console.log(
                  `[MA Cross 15m BG] ⏭️ Posição oposta em ${created.symbol} — sem fecho automático (saída só por SL/TP)`
                );
                continue;
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

export interface Cron15mAllResult {
  maCross: Cron15mResult;
  pivotBoss: Cron15mResult;
  breakout: Cron15mResult;
  scanner3: Scanner3ScanResult;
  scanner3RsiBreakout: Cron15mResult;
}

async function runPivotBoss15mPipeline(now: Date): Promise<Cron15mResult> {
  const pivotStrategy = await prisma.strategy.findFirst({ where: { name: 'PIVOT_BOSS_BEAR_15M' } });
  if (!pivotStrategy) {
    console.warn('[Pivot Boss 15m] Estratégia PIVOT_BOSS_BEAR_15M não encontrada (correr o seed).');
    return { status: 'not-found' };
  }
  if (!pivotStrategy.isActive) {
    console.log('[Pivot Boss 15m] Estratégia inactiva — saltada.');
    return { status: 'inactive' };
  }
  if (isPivotBossBear15mWeekendBlocked(now)) {
    console.log('[Pivot Boss 15m] Fim-de-semana (PT) — saltada.');
    return { status: 'skipped-weekend' };
  }
  if (isPivotBossBear15mHourBlocked(now)) {
    const h = now.toLocaleString('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false });
    console.log(`[Pivot Boss 15m] Horário ${h}h PT bloqueado — saltada.`);
    return { status: 'skipped-hour' };
  }

  try {
    const signalsCreated = await runAllStrategies({ only: ['PIVOT_BOSS_BEAR_15M'] });
    return { status: 'done', signalsCreated };
  } catch (error) {
    console.error('[Pivot Boss 15m] Falhou:', error);
    return { status: 'not-found' };
  }
}

async function runBreakout15mPipeline(): Promise<Cron15mResult> {
  const strategy = await prisma.strategy.findFirst({
    where: { name: 'ACCUMULATION_BREAKOUT_15M' },
  });
  if (!strategy) {
    console.warn('[Rompimento 15m] Estratégia ACCUMULATION_BREAKOUT_15M não encontrada (correr o seed).');
    return { status: 'not-found' };
  }
  if (!strategy.isActive) {
    console.log('[Rompimento 15m] Estratégia inactiva — saltada.');
    return { status: 'inactive' };
  }

  try {
    const signalsCreated = await runAllStrategies({ only: ['ACCUMULATION_BREAKOUT_15M'] });
    return { status: 'done', signalsCreated };
  } catch (error) {
    console.error('[Rompimento 15m] Falhou:', error);
    return { status: 'not-found' };
  }
}

async function runScanner3RsiBreakout15mPipeline(): Promise<Cron15mResult> {
  const strategy = await prisma.strategy.findFirst({
    where: { name: 'SCANNER3_RSI_BREAKOUT_15M' },
  });
  if (!strategy) {
    console.warn(
      '[Scanner3 RSI Rompimento 15m] Estratégia SCANNER3_RSI_BREAKOUT_15M não encontrada (correr o seed).'
    );
    return { status: 'not-found' };
  }
  if (!strategy.isActive) {
    console.log('[Scanner3 RSI Rompimento 15m] Estratégia inactiva — saltada.');
    return { status: 'inactive' };
  }

  try {
    const signalsCreated = await runAllStrategies({ only: ['SCANNER3_RSI_BREAKOUT_15M'] });
    return { status: 'done', signalsCreated };
  } catch (error) {
    console.error('[Scanner3 RSI Rompimento 15m] Falhou:', error);
    return { status: 'not-found' };
  }
}

/**
 * Cron único 15m: Scanner 3 RSI + MA Cross 12×30 + Pivot Boss Bear 15m + Rompimento 15m + Scanner 3 RSI Rompimento.
 */
export async function run15mStrategiesPipeline(now: Date = new Date()): Promise<Cron15mAllResult> {
  const scanner3 = await runScanner3Rsi15mScan('cron/run-15m');
  const scanner3RsiBreakout = await runScanner3RsiBreakout15mPipeline();
  const maCross = await runMaCross15mPipeline(now);
  const pivotBoss = await runPivotBoss15mPipeline(now);
  const breakout = await runBreakout15mPipeline();
  return { maCross, pivotBoss, breakout, scanner3, scanner3RsiBreakout };
}

