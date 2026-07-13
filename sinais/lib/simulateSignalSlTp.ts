import type { StrategySimulationSide } from './strategySimulationProfiles';

export interface SimulateSignalInput {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss?: number | null;
  target1?: number | null;
  target2?: number | null;
  extraInfo?: string | null;
  result24h?: number | null;
  high24h?: number | null;
  low24h?: number | null;
}

export interface ResolvedSlTpLevels {
  stopLossPrice: number;
  takeProfit1Price: number;
  takeProfit2Price: number;
  stopLossPercent: number;
  tp1Percent: number;
  tp2Percent: number;
  tp1Weight: number;
  tp2Weight: number;
  finalWeight: number;
  finalHours: number;
  usedSignalPrices: boolean;
}

function parseExtraInfo(extra: string | null | undefined): Record<string, unknown> {
  if (!extra) return {};
  try {
    const parsed = JSON.parse(extra);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pctDistance(a: number, b: number): number {
  if (!a) return 0;
  return (Math.abs(b - a) / a) * 100;
}

function isValidBuySl(entry: number, sl: number): boolean {
  return sl > 0 && sl < entry;
}

function isValidBuyTp(entry: number, tp: number): boolean {
  return tp > entry;
}

function isValidSellSl(entry: number, sl: number): boolean {
  return sl > entry;
}

function isValidSellTp(entry: number, tp: number): boolean {
  return tp > 0 && tp < entry;
}

/**
 * Preferência: preços SL/TP gravados no sinal (Pivot Boss, MA Cross, etc.);
 * fallback para percentagens do perfil canónico da estratégia.
 */
export function resolveSignalSlTpLevels(
  signal: SimulateSignalInput,
  profileSide: StrategySimulationSide
): ResolvedSlTpLevels {
  const entry = signal.entryPrice;
  const extra = parseExtraInfo(signal.extraInfo);
  const isBuy = signal.direction === 'BUY';

  const tp1PosRaw = Number(extra.tp1Position ?? extra.tp1PositionPct ?? profileSide.tp1PositionPct);
  const tp2PosRaw = Number(extra.tp2Position ?? extra.tp2PositionPct ?? profileSide.tp2PositionPct);
  const tp1Weight = Math.max(0, Math.min(100, Number.isFinite(tp1PosRaw) ? tp1PosRaw : profileSide.tp1PositionPct)) / 100;
  const tp2Weight = Math.max(0, Math.min(100, Number.isFinite(tp2PosRaw) ? tp2PosRaw : profileSide.tp2PositionPct)) / 100;
  const finalWeight = Math.max(0, 1 - tp1Weight - tp2Weight);
  const closeHoursRaw = Number(extra.closeAfterHours ?? profileSide.finalCloseHours);
  const finalHours = Number.isFinite(closeHoursRaw) && closeHoursRaw > 0 ? closeHoursRaw : profileSide.finalCloseHours;

  let stopLossPrice: number;
  let takeProfit1Price: number;
  let takeProfit2Price: number;
  let usedSignalPrices = false;

  const sl = signal.stopLoss;
  const t1 = signal.target1;
  const t2 = signal.target2;

  if (isBuy) {
    const slOk = sl != null && isValidBuySl(entry, sl);
    const t1Ok = t1 != null && isValidBuyTp(entry, t1);
    const t2Ok = t2 != null && isValidBuyTp(entry, t2);

    if (slOk && t1Ok) {
      stopLossPrice = sl!;
      takeProfit1Price = t1!;
      takeProfit2Price = t2Ok ? t2! : entry * (1 + profileSide.tp2Pct / 100);
      usedSignalPrices = true;
    } else {
      stopLossPrice = entry * (1 - profileSide.stopLossPct / 100);
      takeProfit1Price = entry * (1 + profileSide.tp1Pct / 100);
      takeProfit2Price = entry * (1 + profileSide.tp2Pct / 100);
    }
  } else {
    const slOk = sl != null && isValidSellSl(entry, sl);
    const t1Ok = t1 != null && isValidSellTp(entry, t1);
    const t2Ok = t2 != null && isValidSellTp(entry, t2);

    if (slOk && t1Ok) {
      stopLossPrice = sl!;
      takeProfit1Price = t1!;
      takeProfit2Price = t2Ok ? t2! : entry * (1 - profileSide.tp2Pct / 100);
      usedSignalPrices = true;
    } else {
      stopLossPrice = entry * (1 + profileSide.stopLossPct / 100);
      takeProfit1Price = entry * (1 - profileSide.tp1Pct / 100);
      takeProfit2Price = entry * (1 - profileSide.tp2Pct / 100);
    }
  }

  const stopLossPercent = isBuy
    ? pctDistance(entry, stopLossPrice)
    : pctDistance(entry, stopLossPrice);
  const tp1Percent = isBuy
    ? pctDistance(entry, takeProfit1Price)
    : pctDistance(entry, takeProfit1Price);
  const tp2Percent =
    profileSide.tp2Pct > 0 || (t2 != null && ((isBuy && t2 > entry) || (!isBuy && t2 < entry)))
      ? pctDistance(entry, takeProfit2Price)
      : 0;

  return {
    stopLossPrice,
    takeProfit1Price,
    takeProfit2Price,
    stopLossPercent,
    tp1Percent,
    tp2Percent,
    tp1Weight,
    tp2Weight,
    finalWeight,
    finalHours,
    usedSignalPrices,
  };
}

/** Rotação temporizada (ex. 4h): fecho no scan, sem TP — SL só no P&L do hold, não em low/high 24h. */
export function isRotationTimedProfile(profileSide: StrategySimulationSide): boolean {
  return (
    profileSide.finalCloseHours > 0 &&
    profileSide.finalCloseHours < 24 &&
    profileSide.tp1Pct === 0 &&
    profileSide.tp2Pct === 0
  );
}

/** Simula P&L líquido (%) para posição $100 — SL/TP do sinal + parciais + fee round-trip. */
export function simulateSignalNetResultPercent(
  signal: SimulateSignalInput,
  profileSide: StrategySimulationSide,
  feeRoundTripPct = 0.1
): number {
  const levels = resolveSignalSlTpLevels(signal, profileSide);
  const {
    stopLossPrice,
    takeProfit1Price,
    takeProfit2Price,
    stopLossPercent,
    tp1Percent,
    tp2Percent,
    tp1Weight,
    tp2Weight,
    finalWeight,
    finalHours,
  } = levels;

  const base24hPercent =
    signal.result24h == null || !signal.entryPrice
      ? 0
      : (signal.result24h / signal.entryPrice) * 100;
  const hoursMultiplier = Math.max(0.25, finalHours / 24);
  const finalResultPercent = base24hPercent * hoursMultiplier;

  if (isRotationTimedProfile(profileSide)) {
    return Math.max(finalResultPercent, -stopLossPercent) - feeRoundTripPct;
  }

  let grossPercentResult = 0;

  if (signal.direction === 'BUY') {
    if (signal.low24h != null && signal.low24h <= stopLossPrice) {
      grossPercentResult = -stopLossPercent;
    } else if (
      tp2Percent > 0 &&
      tp2Weight > 0 &&
      signal.high24h != null &&
      signal.high24h >= takeProfit2Price
    ) {
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + tp2Weight * tp2Percent + finalWeight * cappedFinal;
    } else if (signal.high24h != null && signal.high24h >= takeProfit1Price) {
      const remainingWeight = Math.max(0, 1 - tp1Weight);
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + remainingWeight * cappedFinal;
    } else {
      grossPercentResult = Math.max(finalResultPercent, -stopLossPercent);
    }
  } else {
    if (signal.high24h != null && signal.high24h >= stopLossPrice) {
      grossPercentResult = -stopLossPercent;
    } else if (
      tp2Percent > 0 &&
      tp2Weight > 0 &&
      signal.low24h != null &&
      signal.low24h <= takeProfit2Price
    ) {
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + tp2Weight * tp2Percent + finalWeight * cappedFinal;
    } else if (signal.low24h != null && signal.low24h <= takeProfit1Price) {
      const remainingWeight = Math.max(0, 1 - tp1Weight);
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + remainingWeight * cappedFinal;
    } else {
      grossPercentResult = Math.max(finalResultPercent, -stopLossPercent);
    }
  }

  return grossPercentResult - feeRoundTripPct;
}
