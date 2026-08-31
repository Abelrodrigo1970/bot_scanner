import { prisma } from '@/lib/db';
import {
  UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
  UNIVERSE_CODE_SCANNER_7_RSI_ABOVE_69_1D,
} from '@/lib/symbolUniverseDefaults';
import { resolveUniverseScanSymbolsTopN } from '@/lib/universeScanPersistence';
import {
  runMaCross15mStrategy,
  strategyAllowsAutoExecuteDirection,
  type StrategyParams,
} from '@/lib/signalEngine';
import {
  checkMaCross15mSignalGate,
  isMaCross12x21HourBlocked,
  isMaCross15mHourBlocked,
  maCross15mGateLimitsFromParams,
  MA_CROSS_15M_MIN_TURNOVER_1H_USD,
  MA_CROSS_12X21_BLOCKED_HOURS_PT,
  MA_CROSS_12X21_ALLOWED_HOUR_MIN_PT,
  MA_CROSS_12X21_ALLOWED_HOUR_MAX_PT,
} from '@/lib/maCross15mGuard';
import { update24hResults } from '@/lib/update24hResults';
import {
  cleanupBybitOrphanOpenOrders,
  executeSignalReal,
  inspectActivePositionForSymbol,
} from '@/lib/tradingExecutor';
import { getAutoExecuteMinStrength } from '@/lib/binanceConfig';
import { runEngolfo15mPipeline } from '@/lib/engolfo15mStrategy';
import { runRompimento20_15mPipeline } from '@/lib/rompimento20_15mStrategy';

const TIMEFRAME_15M = '15m' as const;
const MA_CROSS_MIN_STRENGTH = 70;

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

type MaCrossUniverse = {
  code: string;
  label: string;
  defaultTopN: number;
};

/**
 * MA Cross 15m (spread MA rápida×lenta). Universo conforme estratégia.
 * Tecto diário e cooldown vêm dos params (12×30: 2/dia + 24h; 12×21: sem tecto).
 */
async function runMaCross15mWorker(
  strategy: StrategyData,
  params: StrategyParams,
  universe: MaCrossUniverse,
  logTag: string
): Promise<number> {
  const DELAY_MS = 200;
  const topN = Math.max(1, Math.floor(Number(params.universeTopN ?? universe.defaultTopN)));
  const minTurnover3hUsd = Math.max(
    0,
    Number(params.minTurnover3hUsd ?? MA_CROSS_15M_MIN_TURNOVER_1H_USD)
  );
  const symbols = await resolveUniverseScanSymbolsTopN(universe.code, topN);
  if (symbols.length === 0) {
    console.warn(
      `[${logTag} BG] ${universe.label} vazio. Corra /api/cron/run-universe-scans.`
    );
  }
  console.log(
    `[${logTag} BG] Iniciando ${symbols.length} símbolos (${universe.label} top ${topN})…`
  );
  let signalsCreated = 0;
  const ex = (params.exchange === 'bybit' ? 'bybit' : 'binance') as 'binance' | 'bybit';

  for (const symbol of symbols) {
    try {
      const signalResult = await runMaCross15mStrategy(symbol, TIMEFRAME_15M, params);

      if (signalResult && signalResult.strength >= MA_CROSS_MIN_STRENGTH) {
        const posGate = await inspectActivePositionForSymbol(symbol, ex);
        if (
          posGate.inspectable &&
          posGate.hasPosition &&
          posGate.direction === signalResult.direction
        ) {
          continue;
        }

        const gateLimits = maCross15mGateLimitsFromParams(params);
        const gate = await checkMaCross15mSignalGate(prisma, {
          symbol,
          strategyId: strategy.id,
          direction: signalResult.direction,
          minTurnover3hUsd,
          maxSignalsPerDay: gateLimits.maxSignalsPerDay,
          cooldownMs: gateLimits.cooldownMs,
          ...(params.maCross12x21EntryFilters === true
            ? {
                blockedHoursPt:
                  (params.blockedHoursPt as number[] | undefined) ??
                  [...MA_CROSS_12X21_BLOCKED_HOURS_PT],
                allowedHourMinPt: Number(
                  params.allowedHourMinPt ?? MA_CROSS_12X21_ALLOWED_HOUR_MIN_PT
                ),
                allowedHourMaxPt: Number(
                  params.allowedHourMaxPt ?? MA_CROSS_12X21_ALLOWED_HOUR_MAX_PT
                ),
              }
            : {}),
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

          const autoMinStrength = Math.max(
            MA_CROSS_MIN_STRENGTH,
            Number(params.autoExecuteMinStrength ?? getAutoExecuteMinStrength())
          );
          if (
            signalResult.strength >= autoMinStrength &&
            strategyAllowsAutoExecuteDirection(signalResult.direction, params)
          ) {
            console.log(
              `[${logTag} BG] Auto-exec (${ex}): ${symbol} força ${signalResult.strength} (>= ${autoMinStrength})`
            );
            try {
              const positionState = await inspectActivePositionForSymbol(created.symbol, ex);
              if (!positionState.inspectable) {
                console.warn(
                  `[${logTag} BG] ⚠️ Não foi possível inspecionar ${created.symbol}: ${positionState.message}`
                );
                continue;
              }

              if (positionState.hasPosition && positionState.direction === created.direction) {
                console.log(
                  `[${logTag} BG] ⏭️ Já existe posição real em ${created.symbol} (${positionState.direction}) — sinal ignorado`
                );
                continue;
              }

              if (positionState.hasPosition && positionState.direction !== created.direction) {
                console.log(
                  `[${logTag} BG] ⏭️ Posição oposta em ${created.symbol} — sem fecho automático (saída só por SL/TP)`
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
                console.log(
                  `[${logTag} BG] Auto-executado: ${created.symbol} order ${result.orderId}`
                );
              } else {
                console.warn(
                  `[${logTag} BG] Auto-exec falhou ${created.symbol}: ${result.message}`
                );
              }
            } catch (err) {
              console.error(`[${logTag} BG] Erro auto-exec ${created.symbol}:`, err);
            }
          }
        } else {
          console.log(`[${logTag} BG] ⏭️ ${symbol}: ${gate.reason}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    } catch (error) {
      console.error(`[${logTag} BG] Erro ${symbol}:`, error);
    }
  }

  const update24h = await update24hResults();
  const orphanCleanup = await cleanupBybitOrphanOpenOrders();
  if (orphanCleanup.cancelledSymbols.length > 0 || orphanCleanup.errors.length > 0) {
    console.log(
      `[${logTag} BG] Bybit órfãs: cancelados ${orphanCleanup.cancelledSymbols.length} símbolo(s)` +
        (orphanCleanup.errors.length ? `; erros: ${orphanCleanup.errors.join('; ')}` : '')
    );
  }
  console.log(
    `[${logTag} BG] Concluído: ${signalsCreated} sinais, 24h atualizados: ${update24h.updated}`
  );
  return signalsCreated;
}

async function runNamedMaCrossPipeline(
  strategyName: string,
  universe: MaCrossUniverse,
  logTag: string,
  now: Date
): Promise<Cron15mResult> {
  const strategy = await prisma.strategy.findFirst({ where: { name: strategyName } });
  if (!strategy) {
    console.warn(`[${logTag}] Estratégia ${strategyName} não encontrada (correr o seed).`);
    return { status: 'not-found' };
  }
  if (!strategy.isActive) {
    console.log(`[${logTag}] Estratégia inactiva — saltada.`);
    return { status: 'inactive' };
  }
  if (isMaCross15mHourBlocked(now)) {
    const h = now.toLocaleString('en-GB', {
      timeZone: 'Europe/Lisbon',
      hour: '2-digit',
      hour12: false,
    });
    console.log(`[${logTag}] Horário ${h}h PT bloqueado — saltada.`);
    return { status: 'skipped-hour' };
  }
  if (strategyName === 'MA_CROSS_12X21_S2' && isMaCross12x21HourBlocked(now)) {
    const h = now.toLocaleString('en-GB', {
      timeZone: 'Europe/Lisbon',
      hour: '2-digit',
      hour12: false,
    });
    console.log(`[${logTag}] Horário ${h}h PT bloqueado (12×21: 11–22h, evita 4–10h) — saltada.`);
    return { status: 'skipped-hour' };
  }

  const params = JSON.parse(strategy.params || '{}') as StrategyParams;
  const signalsCreated = await runMaCross15mWorker(
    { id: strategy.id, displayName: strategy.displayName },
    params,
    universe,
    logTag
  );
  return { status: 'done', signalsCreated };
}

/** Pipeline MA Cross 12×30 (Scanner 1). */
export async function runMaCross15mPipeline(now: Date = new Date()): Promise<Cron15mResult> {
  return runNamedMaCrossPipeline(
    'MA_CROSS_5M',
    {
      code: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
      label: 'Scanner 1',
      defaultTopN: 20,
    },
    'MA Cross 12×30',
    now
  );
}

/** Pipeline MA Cross 12×21 (Scanner 7 RSI 1d ≥ 69, só COMPRA). */
export async function runMaCross12x21Scanner2Pipeline(
  now: Date = new Date()
): Promise<Cron15mResult> {
  return runNamedMaCrossPipeline(
    'MA_CROSS_12X21_S2',
    {
      code: UNIVERSE_CODE_SCANNER_7_RSI_ABOVE_69_1D,
      label: 'Scanner 7',
      defaultTopN: 80,
    },
    'MA Cross 12×21 S7',
    now
  );
}

export interface Cron15mAllResult {
  maCross: Cron15mResult;
  maCross12x21S2: Cron15mResult;
  engolfo: Cron15mResult;
  rompimento20: Cron15mResult;
}

/**
 * Cron único 15m: MA Cross 12×30 (S1) + MA Cross 12×21 (S7, só BUY) + engolfo (S2) + Rompimento 20 (S1).
 */
export async function run15mStrategiesPipeline(now: Date = new Date()): Promise<Cron15mAllResult> {
  const maCross = await runMaCross15mPipeline(now);
  const maCross12x21S2 = await runMaCross12x21Scanner2Pipeline(now);

  let engolfo: Cron15mResult;
  try {
    const r = await runEngolfo15mPipeline({ logPrefix: '[Run-15m → engolfo]' });
    if (r.status === 'skipped') {
      console.log(`[Run-15m → engolfo] Saltado: ${r.reason}`);
      if (r.reason.includes('inactiva')) engolfo = { status: 'inactive' };
      else if (r.reason.includes('não encontrada')) engolfo = { status: 'not-found' };
      else engolfo = { status: 'done', signalsCreated: 0 };
    } else {
      engolfo = { status: 'done', signalsCreated: r.signalsCreated };
    }
  } catch (err) {
    console.error('[Run-15m → engolfo] Falhou:', err);
    engolfo = { status: 'not-found' };
  }

  let rompimento20: Cron15mResult;
  try {
    const r = await runRompimento20_15mPipeline({ logPrefix: '[Run-15m → rompimento20]' });
    if (r.status === 'skipped') {
      console.log(`[Run-15m → rompimento20] Saltado: ${r.reason}`);
      if (r.reason.includes('inactiva')) rompimento20 = { status: 'inactive' };
      else if (r.reason.includes('não encontrada')) rompimento20 = { status: 'not-found' };
      else rompimento20 = { status: 'done', signalsCreated: 0 };
    } else {
      rompimento20 = { status: 'done', signalsCreated: r.signalsCreated };
    }
  } catch (err) {
    console.error('[Run-15m → rompimento20] Falhou:', err);
    rompimento20 = { status: 'not-found' };
  }

  return { maCross, maCross12x21S2, engolfo, rompimento20 };
}
