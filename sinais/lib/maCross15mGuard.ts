import type { PrismaClient } from '@prisma/client';

export const MA_CROSS_15M_TIMEFRAME = '15m' as const;
export const MA_CROSS_15M_TZ = 'Europe/Lisbon';

/** Cooldown mínimo entre sinais MA Cross 15m no mesmo símbolo (qualquer direção). */
export const MA_CROSS_5M_SIGNAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function localDayKey(date: Date, timeZone = MA_CROSS_15M_TZ): string {
  return date.toLocaleDateString('sv-SE', { timeZone });
}

/** Sábado ou domingo no fuso de Portugal (Europe/Lisbon). */
export function isMaCross15mWeekendBlocked(now: Date = new Date()): boolean {
  const dow = now.toLocaleDateString('en-US', { timeZone: MA_CROSS_15M_TZ, weekday: 'short' });
  return dow === 'Sat' || dow === 'Sun';
}

export interface MaCross15mSignalGateInput {
  symbol: string;
  strategyId: string;
  now?: Date;
}

export type MaCross15mSignalGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Regras de criação de sinal MA Cross 15m (análise Mai/2026):
 * - cooldown 24h por símbolo (qualquer direção)
 * - máx. 1 sinal por símbolo por dia civil (PT)
 */
export async function checkMaCross15mSignalGate(
  prisma: PrismaClient,
  input: MaCross15mSignalGateInput
): Promise<MaCross15mSignalGateResult> {
  const now = input.now ?? new Date();
  const cooldownSince = new Date(now.getTime() - MA_CROSS_5M_SIGNAL_COOLDOWN_MS);

  const recentCooldown = await prisma.signal.findFirst({
    where: {
      symbol: input.symbol,
      strategyId: input.strategyId,
      timeframe: MA_CROSS_15M_TIMEFRAME,
      generatedAt: { gte: cooldownSince },
    },
    orderBy: { generatedAt: 'desc' },
    select: { generatedAt: true, symbol: true },
  });

  if (recentCooldown) {
    return {
      allowed: false,
      reason: `cooldown 24h (${input.symbol}, último ${recentCooldown.generatedAt.toISOString()})`,
    };
  }

  const dayKey = localDayKey(now);
  const dayLookback = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const sameDayCandidate = await prisma.signal.findFirst({
    where: {
      symbol: input.symbol,
      strategyId: input.strategyId,
      timeframe: MA_CROSS_15M_TIMEFRAME,
      generatedAt: { gte: dayLookback },
    },
    orderBy: { generatedAt: 'desc' },
    select: { generatedAt: true, symbol: true },
  });

  if (sameDayCandidate && localDayKey(sameDayCandidate.generatedAt) === dayKey) {
    return {
      allowed: false,
      reason: `máx. 1 sinal/dia PT (${input.symbol}, dia ${dayKey})`,
    };
  }

  return { allowed: true };
}
