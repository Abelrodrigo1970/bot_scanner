import type { PrismaClient } from '@prisma/client';
import {
  hourInLisbon,
  isWeekendInLisbon,
  localDayKey,
  MA_CROSS_15M_TZ,
} from './maCross15mGuard';
import { fetchLastClosed1hQuoteVolumeUsd } from './marketData';

/** Horas PT tóxicas (análise 2026, SL 8%, força ≥70, dias úteis). */
export const PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT: readonly number[] = [18, 22];

/** Turnover máximo 1h USDT — pares muito líquidos performam pior (análise Abr–Mai/2026). */
export const PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD = 5_000_000;

export function isPivotBossBear15mHourBlocked(now: Date = new Date()): boolean {
  return PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.includes(hourInLisbon(now));
}

export function isPivotBossBear15mWeekendBlocked(now: Date = new Date()): boolean {
  return isWeekendInLisbon(now);
}

export function isPivotBossBear15mSessionBlocked(now: Date = new Date()): boolean {
  return isPivotBossBear15mWeekendBlocked(now) || isPivotBossBear15mHourBlocked(now);
}

export function isPivotBossBear15mTurnoverBlocked(turnover1hUsd: number): boolean {
  return turnover1hUsd > PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD;
}
export interface PivotBossDailyGateInput {
  symbol: string;
  strategyId: string;
  timeframe: string;
  now?: Date;
}

export type PivotBossDailyGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Máx. 1 sinal por símbolo/estratégia por dia civil (PT). */
export async function checkPivotBossDailySignalGate(
  prisma: PrismaClient,
  input: PivotBossDailyGateInput
): Promise<PivotBossDailyGateResult> {
  const now = input.now ?? new Date();

  if (input.timeframe === '15m' && isPivotBossBear15mWeekendBlocked(now)) {
    return {
      allowed: false,
      reason: 'fim-de-semana bloqueado (sáb/dom, horário PT)',
    };
  }

  if (input.timeframe === '15m' && isPivotBossBear15mHourBlocked(now)) {
    return {
      allowed: false,
      reason: `horário bloqueado (${hourInLisbon(now)}h PT; Pivot Boss 15m)`,
    };
  }

  if (input.timeframe === '15m') {
    const turnover1h = await fetchLastClosed1hQuoteVolumeUsd(input.symbol);
    if (turnover1h != null && isPivotBossBear15mTurnoverBlocked(turnover1h)) {
      return {
        allowed: false,
        reason: `turnover 1h demasiado alto ($${(turnover1h / 1e6).toFixed(2)}M > $${PIVOT_BOSS_BEAR_15M_MAX_TURNOVER_1H_USD / 1e6}M)`,
      };
    }
  }

  const dayKey = localDayKey(now, MA_CROSS_15M_TZ);
  const dayLookback = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const recentSignals = await prisma.signal.findMany({
    where: {
      symbol: input.symbol,
      strategyId: input.strategyId,
      timeframe: input.timeframe,
      generatedAt: { gte: dayLookback },
    },
    select: { generatedAt: true },
    orderBy: { generatedAt: 'desc' },
    take: 5,
  });

  for (const sig of recentSignals) {
    if (localDayKey(sig.generatedAt, MA_CROSS_15M_TZ) === dayKey) {
      return {
        allowed: false,
        reason: `máx. 1 sinal/dia PT (já existe às ${sig.generatedAt.toISOString()})`,
      };
    }
  }

  return { allowed: true };
}
