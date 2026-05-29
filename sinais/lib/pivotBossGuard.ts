import type { PrismaClient } from '@prisma/client';
import {
  hourInLisbon,
  isMaCross15mWeekendBlocked,
  localDayKey,
  MA_CROSS_15M_TZ,
} from './maCross15mGuard';

/** Horas PT tóxicas (análise 2026, SL 8%, força ≥70, dias úteis). */
export const PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT: readonly number[] = [18, 22];

export function isPivotBossBear15mHourBlocked(now: Date = new Date()): boolean {
  return PIVOT_BOSS_BEAR_15M_BLOCKED_HOURS_PT.includes(hourInLisbon(now));
}

export function isPivotBossBear15mWeekendBlocked(now: Date = new Date()): boolean {
  return isMaCross15mWeekendBlocked(now);
}

export function isPivotBossBear15mSessionBlocked(now: Date = new Date()): boolean {
  return isPivotBossBear15mWeekendBlocked(now) || isPivotBossBear15mHourBlocked(now);
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
