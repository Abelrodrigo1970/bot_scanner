import type { PrismaClient } from '@prisma/client';
import { fetchCurrentPrice, fetchLastClosed1hQuoteVolumeUsd } from './marketData';

export const MA_CROSS_15M_TIMEFRAME = '15m' as const;
export const MA_CROSS_15M_TZ = 'Europe/Lisbon';

/** Cooldown mínimo entre o 1.º sinal do dia e o último sinal anterior (outro dia). */
export const MA_CROSS_5M_SIGNAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Horas PT rentáveis com SL/TP real (análise 2026, força ≥70, dias úteis). Requer cron 24h para incluir 3h e 7h. */
export const MA_CROSS_15M_ALLOWED_HOURS_PT: readonly number[] = [3, 7, 15, 17, 19];

/** Complemento de {@link MA_CROSS_15M_ALLOWED_HOURS_PT} (0–23 PT). */
export const MA_CROSS_15M_BLOCKED_HOURS_PT: readonly number[] = Array.from({ length: 24 }, (_, h) => h).filter(
  (h) => !MA_CROSS_15M_ALLOWED_HOURS_PT.includes(h)
);

/** Turnover mínimo 1h USDT (análise Abr–Mai/2026, força ≥70). */
export const MA_CROSS_15M_MIN_TURNOVER_1H_USD = 10_000_000;

/** Taxa round-trip usada na simulação Abr+Mai/2026 (alinhada com `simulate-2nd-if-green.mjs`). */
export const MA_CROSS_15M_ROUND_TRIP_FEE_PCT = 0.1;

export function localDayKey(date: Date, timeZone = MA_CROSS_15M_TZ): string {
  return date.toLocaleDateString('sv-SE', { timeZone });
}

export function hourInLisbon(date: Date = new Date()): number {
  return +date.toLocaleString('en-GB', { timeZone: MA_CROSS_15M_TZ, hour: '2-digit', hour12: false });
}

/** Sábado ou domingo no fuso de Portugal (Europe/Lisbon). */
export function isMaCross15mWeekendBlocked(now: Date = new Date()): boolean {
  const dow = now.toLocaleDateString('en-US', { timeZone: MA_CROSS_15M_TZ, weekday: 'short' });
  return dow === 'Sat' || dow === 'Sun';
}

export function isMaCross15mHourBlocked(now: Date = new Date()): boolean {
  return !MA_CROSS_15M_ALLOWED_HOURS_PT.includes(hourInLisbon(now));
}

export function isMaCross15mTurnoverBlocked(turnover1hUsd: number): boolean {
  return turnover1hUsd < MA_CROSS_15M_MIN_TURNOVER_1H_USD;
}

export interface MaCross15mSignalGateInput {
  symbol: string;
  strategyId: string;
  direction: 'BUY' | 'SELL';
  now?: Date;
}

export type MaCross15mSignalGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

type DaySignalRow = {
  generatedAt: Date;
  direction: string;
  entryPrice: number;
  result24h: number | null;
  status: string;
  status24h: string | null;
};

function isClosedSignal(signal: DaySignalRow): boolean {
  return signal.status === 'EXPIRED' || signal.status24h === 'CLOSED';
}

/** Lucro líquido ≥ 0 vs entrada (mesma fórmula da simulação: result24h/entry em % − taxa). */
function isNetProfitable(entryPrice: number, result24h: number): boolean {
  if (entryPrice <= 0) return false;
  return (result24h / entryPrice) * 100 - MA_CROSS_15M_ROUND_TRIP_FEE_PCT >= 0;
}

async function isSignalProfitable(
  signal: DaySignalRow,
  symbol: string
): Promise<boolean> {
  if (signal.result24h != null) {
    return isNetProfitable(signal.entryPrice, signal.result24h);
  }

  if (!isClosedSignal(signal)) {
    return false;
  }

  try {
    const currentPrice = await fetchCurrentPrice(symbol);
    const result =
      signal.direction === 'SELL'
        ? signal.entryPrice - currentPrice
        : currentPrice - signal.entryPrice;
    return isNetProfitable(signal.entryPrice, result);
  } catch {
    return false;
  }
}

/**
 * Regras MA Cross 15m (análise horária 2026):
 * - sem fim-de-semana (cron) e só horas PT permitidas (whitelist)
 * - turnover 1h ≥ $10M USDT (Binance)
 * - 1.º sinal do dia: cooldown 24h desde o último sinal do par
 * - 2.º sinal no mesmo dia: só se 1.º fechado, verde (líquido) e mesma direção
 * - máx. 2 sinais por símbolo por dia civil (PT)
 */
export async function checkMaCross15mSignalGate(
  prisma: PrismaClient,
  input: MaCross15mSignalGateInput
): Promise<MaCross15mSignalGateResult> {
  const now = input.now ?? new Date();

  if (isMaCross15mHourBlocked(now)) {
    return {
      allowed: false,
      reason: `horário bloqueado (${hourInLisbon(now)}h PT; permitido ${MA_CROSS_15M_ALLOWED_HOURS_PT.join(', ')}h)`,
    };
  }

  const turnover1h = await fetchLastClosed1hQuoteVolumeUsd(input.symbol);
  if (turnover1h == null) {
    return {
      allowed: false,
      reason: `turnover 1h indisponível (${input.symbol})`,
    };
  }
  if (isMaCross15mTurnoverBlocked(turnover1h)) {
    return {
      allowed: false,
      reason: `turnover 1h insuficiente ($${(turnover1h / 1e6).toFixed(2)}M < $${MA_CROSS_15M_MIN_TURNOVER_1H_USD / 1e6}M)`,
    };
  }

  const dayKey = localDayKey(now);
  const dayLookback = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const recentDaySignals = await prisma.signal.findMany({
    where: {
      symbol: input.symbol,
      strategyId: input.strategyId,
      timeframe: MA_CROSS_15M_TIMEFRAME,
      generatedAt: { gte: dayLookback },
    },
    orderBy: { generatedAt: 'asc' },
    select: {
      generatedAt: true,
      direction: true,
      entryPrice: true,
      result24h: true,
      status: true,
      status24h: true,
    },
  });

  const todaySignals: DaySignalRow[] = recentDaySignals.filter(
    (s) => localDayKey(s.generatedAt) === dayKey
  );

  if (todaySignals.length >= 2) {
    return {
      allowed: false,
      reason: `máx. 2 sinais/dia PT (${input.symbol}, dia ${dayKey})`,
    };
  }

  if (todaySignals.length === 1) {
    const first = todaySignals[0]!;

    if (!isClosedSignal(first)) {
      return {
        allowed: false,
        reason: `2.º sinal aguarda fecho do 1.º (${input.symbol}, status ${first.status})`,
      };
    }

    if (first.direction !== input.direction) {
      return {
        allowed: false,
        reason: `2.º sinal exige mesma direção (${first.direction} → ${input.direction})`,
      };
    }

    const firstGreen = await isSignalProfitable(first, input.symbol);
    if (!firstGreen) {
      return {
        allowed: false,
        reason: `2.º sinal bloqueado — 1.º do dia não está verde (${input.symbol})`,
      };
    }

    if (now.getTime() <= first.generatedAt.getTime()) {
      return {
        allowed: false,
        reason: '2.º sinal deve ser posterior ao 1.º do dia',
      };
    }

    return { allowed: true };
  }

  const cooldownSince = new Date(now.getTime() - MA_CROSS_5M_SIGNAL_COOLDOWN_MS);
  const recentCooldown = await prisma.signal.findFirst({
    where: {
      symbol: input.symbol,
      strategyId: input.strategyId,
      timeframe: MA_CROSS_15M_TIMEFRAME,
      generatedAt: { gte: cooldownSince },
    },
    orderBy: { generatedAt: 'desc' },
    select: { generatedAt: true },
  });

  if (recentCooldown) {
    return {
      allowed: false,
      reason: `cooldown 24h (${input.symbol}, último ${recentCooldown.generatedAt.toISOString()})`,
    };
  }

  return { allowed: true };
}
