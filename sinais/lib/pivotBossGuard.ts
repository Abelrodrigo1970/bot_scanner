import type { PrismaClient } from '@prisma/client';
import { localDayKey, MA_CROSS_15M_TZ } from './maCross15mGuard';

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
