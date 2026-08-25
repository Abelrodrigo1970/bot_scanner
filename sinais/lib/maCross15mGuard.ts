import type { PrismaClient } from '@prisma/client';
import { fetchCurrentPriceSafe, fetchLast3Closed1hQuoteVolumeUsdSum } from './marketData';

export const MA_CROSS_15M_TIMEFRAME = '15m' as const;
export const MA_CROSS_15M_TZ = 'Europe/Lisbon';

/** Cooldown mínimo entre o 1.º sinal do dia e o último sinal anterior (outro dia). */
export const MA_CROSS_5M_SIGNAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Referência histórica (análise 2026). Filtro de horas desactivado — sinais em qualquer hora PT. */
export const MA_CROSS_15M_ALLOWED_HOURS_PT: readonly number[] = [3, 7, 15, 17, 19];

/** Complemento de {@link MA_CROSS_15M_ALLOWED_HOURS_PT} (scripts de análise). */
export const MA_CROSS_15M_BLOCKED_HOURS_PT: readonly number[] = Array.from({ length: 24 }, (_, h) => h).filter(
  (h) => !MA_CROSS_15M_ALLOWED_HOURS_PT.includes(h)
);

/** MA Cross 12×21: evitar madrugada PT 4h–10h (estudo Ago 2026). */
export const MA_CROSS_12X21_BLOCKED_HOURS_PT: readonly number[] = [4, 5, 6, 7, 8, 9, 10];

/** Janela operacional MA Cross 12×21 após excluir 4h–10h dentro de 9h–22h → 11h–22h PT. */
export const MA_CROSS_12X21_ALLOWED_HOUR_MIN_PT = 11;
export const MA_CROSS_12X21_ALLOWED_HOUR_MAX_PT = 22;

export function isMaCross12x21HourBlocked(now: Date = new Date()): boolean {
  const h = hourInLisbon(now);
  if (h < MA_CROSS_12X21_ALLOWED_HOUR_MIN_PT || h > MA_CROSS_12X21_ALLOWED_HOUR_MAX_PT) {
    return true;
  }
  return MA_CROSS_12X21_BLOCKED_HOURS_PT.includes(h);
}

/** Soma mínima do turnover das 3 últimas velas 1h fechadas (USDT). */
export const MA_CROSS_15M_MIN_TURNOVER_1H_USD = 3_000_000;

/** Taxa round-trip usada na simulação Abr+Mai/2026 (alinhada com `simulate-2nd-if-green.mjs`). */
export const MA_CROSS_15M_ROUND_TRIP_FEE_PCT = 0.1;

export function localDayKey(date: Date, timeZone = MA_CROSS_15M_TZ): string {
  return date.toLocaleDateString('sv-SE', { timeZone });
}

export function hourInLisbon(date: Date = new Date()): number {
  return +date.toLocaleString('en-GB', { timeZone: MA_CROSS_15M_TZ, hour: '2-digit', hour12: false });
}

/** Sábado ou domingo no fuso de Portugal (Europe/Lisbon). */
export function isWeekendInLisbon(now: Date = new Date()): boolean {
  const dow = now.toLocaleDateString('en-US', { timeZone: MA_CROSS_15M_TZ, weekday: 'short' });
  return dow === 'Sat' || dow === 'Sun';
}

/** Sempre false — MA Cross 12×30 activo sáb/dom. */
export function isMaCross15mWeekendBlocked(_now: Date = new Date()): boolean {
  return false;
}

/** Sempre false — MA Cross 12×30 aceita sinais a qualquer hora (PT). */
export function isMaCross15mHourBlocked(_now: Date = new Date()): boolean {
  return false;
}

export function isMaCross15mTurnoverBlocked(
  turnover3hSumUsd: number,
  minUsd: number = MA_CROSS_15M_MIN_TURNOVER_1H_USD
): boolean {
  return turnover3hSumUsd < minUsd;
}

export interface MaCross15mSignalGateInput {
  symbol: string;
  strategyId: string;
  direction: 'BUY' | 'SELL';
  now?: Date;
  /** Override do mínimo turnover 3×1h (USDT). */
  minTurnover3hUsd?: number;
  /** Máx. sinais/símbolo/dia PT. 0 = sem tecto diário. Default 2. */
  maxSignalsPerDay?: number;
  /** Cooldown desde o último sinal (ms). 0 = sem cooldown. Default 24h. */
  cooldownMs?: number;
  /** Horas PT bloqueadas (ex. MA Cross 12×21: 4–10h). */
  blockedHoursPt?: readonly number[];
  allowedHourMinPt?: number;
  allowedHourMaxPt?: number;
}

/** Lê tecto diário e cooldown dos params da estratégia. */
export function maCross15mGateLimitsFromParams(params: Record<string, unknown>): {
  maxSignalsPerDay: number;
  cooldownMs: number;
} {
  const maxRaw = params.maxSignalsPerDay;
  const maxSignalsPerDay =
    maxRaw == null || maxRaw === ''
      ? 2
      : Math.max(0, Math.floor(Number(maxRaw)));
  const hoursRaw = params.signalCooldownHours;
  const cooldownMs =
    hoursRaw == null || hoursRaw === ''
      ? MA_CROSS_5M_SIGNAL_COOLDOWN_MS
      : Math.max(0, Number(hoursRaw)) * 3600_000;
  return {
    maxSignalsPerDay: Number.isFinite(maxSignalsPerDay) ? maxSignalsPerDay : 2,
    cooldownMs: Number.isFinite(cooldownMs) ? cooldownMs : MA_CROSS_5M_SIGNAL_COOLDOWN_MS,
  };
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
    const currentPrice = await fetchCurrentPriceSafe(symbol);
    if (currentPrice == null) return false;
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
 * - activo sáb/dom; qualquer hora PT
 * - soma turnover 3 últimas velas 1h ≥ $3M USDT
 * - 1.º sinal do dia: cooldown 24h desde o último sinal do par (salvo cooldownMs = 0)
 * - 2.º sinal no mesmo dia: só se 1.º fechado, verde (líquido) e mesma direção
 * - máx. N sinais por símbolo por dia civil PT (0 = sem tecto)
 */
export async function checkMaCross15mSignalGate(
  prisma: PrismaClient,
  input: MaCross15mSignalGateInput
): Promise<MaCross15mSignalGateResult> {
  const now = input.now ?? new Date();
  const maxSignalsPerDay = input.maxSignalsPerDay ?? 2;
  const cooldownMs = input.cooldownMs ?? MA_CROSS_5M_SIGNAL_COOLDOWN_MS;

  if (isMaCross15mHourBlocked(now)) {
    return {
      allowed: false,
      reason: `horário bloqueado (${hourInLisbon(now)}h PT; permitido ${MA_CROSS_15M_ALLOWED_HOURS_PT.join(', ')}h)`,
    };
  }

  const h = hourInLisbon(now);
  if (input.blockedHoursPt?.includes(h)) {
    return {
      allowed: false,
      reason: `horário bloqueado (${h}h PT; evitar ${input.blockedHoursPt.join(', ')}h)`,
    };
  }
  if (
    input.allowedHourMinPt != null &&
    input.allowedHourMaxPt != null &&
    (h < input.allowedHourMinPt || h > input.allowedHourMaxPt)
  ) {
    return {
      allowed: false,
      reason: `horário bloqueado (${h}h PT; permitido ${input.allowedHourMinPt}–${input.allowedHourMaxPt}h)`,
    };
  }

  const turnover3hSum = await fetchLast3Closed1hQuoteVolumeUsdSum(input.symbol);
  if (turnover3hSum == null) {
    return {
      allowed: false,
      reason: `turnover 3×1h indisponível (${input.symbol})`,
    };
  }
  if (isMaCross15mTurnoverBlocked(
    turnover3hSum,
    input.minTurnover3hUsd ?? MA_CROSS_15M_MIN_TURNOVER_1H_USD
  )) {
    const minUsd = input.minTurnover3hUsd ?? MA_CROSS_15M_MIN_TURNOVER_1H_USD;
    return {
      allowed: false,
      reason: `soma turnover 3 velas 1h insuficiente ($${(turnover3hSum / 1e6).toFixed(2)}M < $${minUsd / 1e6}M)`,
    };
  }

  const dayKey = localDayKey(now);

  if (maxSignalsPerDay > 0) {
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

    if (todaySignals.length >= maxSignalsPerDay) {
      return {
        allowed: false,
        reason: `máx. ${maxSignalsPerDay} sinais/dia PT (${input.symbol}, dia ${dayKey})`,
      };
    }

    if (todaySignals.length === 1 && maxSignalsPerDay === 2) {
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
  }

  if (cooldownMs <= 0) {
    return { allowed: true };
  }

  const cooldownSince = new Date(now.getTime() - cooldownMs);
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
      reason: `cooldown ${Math.round(cooldownMs / 3600_000)}h (${input.symbol}, último ${recentCooldown.generatedAt.toISOString()})`,
    };
  }

  return { allowed: true };
}
