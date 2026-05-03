/**
 * Funções para calcular indicadores técnicos
 * Usa a biblioteca technicalindicators
 */

import { RSI, SMA, MACD, EMA, ATR, BollingerBands } from 'technicalindicators';
import type { Candle } from './marketData';

/**
 * Calcula o RSI (Relative Strength Index)
 */
export function calculateRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) {
    return null;
  }

  const rsiValues = RSI.calculate({
    values: closes,
    period: period,
  });

  return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
}

/** Série RSI (um valor por vela fechada após warm-up), alinhada com TradingView “RSI Length”. */
export function calculateRSISeries(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) {
    return [];
  }
  return RSI.calculate({ values: closes, period });
}

/**
 * Calcula Média Móvel Simples (SMA)
 */
export function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }

  const smaValues = SMA.calculate({
    values: values,
    period: period,
  });

  return smaValues.length > 0 ? smaValues[smaValues.length - 1] : null;
}

/** Série SMA completa (para suavizar RSI, etc.). */
export function calculateSMASeries(values: number[], period: number): number[] {
  if (values.length < period) {
    return [];
  }
  return SMA.calculate({ values, period });
}

/**
 * Último valor da EMA no fecho (alinhado com indicadores tipo TradingView para MA30/MA200).
 */
export function calculateLastEMA(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }

  const emaValues = EMA.calculate({
    values,
    period,
  });

  if (!emaValues || emaValues.length === 0) {
    return null;
  }

  const last = emaValues[emaValues.length - 1];
  return typeof last === 'number' && Number.isFinite(last) ? last : null;
}

/**
 * Calcula MACD
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 7
): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < slowPeriod + signalPeriod) {
    return null;
  }

  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: fastPeriod,
    slowPeriod: slowPeriod,
    signalPeriod: signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  if (macdValues.length === 0) {
    return null;
  }

  const last = macdValues[macdValues.length - 1];
  return {
    macd: last.MACD || 0,
    signal: last.signal || 0,
    histogram: last.histogram || 0,
  };
}

/**
 * Extrai array de preços de fechamento de candles
 */
export function getCloses(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/**
 * Calcula o preço mais alto em um período
 */
export function getHighestHigh(candles: Candle[], period: number): number {
  const recent = candles.slice(-period);
  return Math.max(...recent.map((c) => c.high));
}

/**
 * Calcula o preço mais baixo em um período
 */
export function getLowestLow(candles: Candle[], period: number): number {
  const recent = candles.slice(-period);
  return Math.min(...recent.map((c) => c.low));
}

/**
 * Calcula EMA (Exponential Moving Average)
 */
export function calculateEMA(values: number[], period: number): number[] | null {
  if (values.length < period) {
    return null;
  }

  const emaValues = EMA.calculate({
    values: values,
    period: period,
  });

  return emaValues.length > 0 ? emaValues : null;
}

/**
 * Calcula ATR (Average True Range)
 */
export function calculateATR(candles: Candle[], period: number = 13): number | null {
  if (candles.length < period + 1) {
    return null;
  }

  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);

  const atrValues = ATR.calculate({
    high: high,
    low: low,
    close: close,
    period: period,
  });

  return atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;
}

/**
 * Calcula Volume Moving Average
 */
export function calculateVolumeMA(volumes: number[], period: number): number | null {
  if (volumes.length < period) {
    return null;
  }

  const smaValues = SMA.calculate({
    values: volumes,
    period: period,
  });

  return smaValues.length > 0 ? smaValues[smaValues.length - 1] : null;
}

/**
 * Extrai array de volumes de candles
 */
export function getVolumes(candles: Candle[]): number[] {
  return candles.map((c) => c.volume);
}

/**
 * Calcula PMO (Price Momentum Oscillator) conforme TradingView
 * 
 * Código Pine Script TradingView:
 * pmo = ema(10 * ema(nz(roc(src, 1)), firstLength), secondLength)
 * 
 * Fórmula correta:
 * 1. ROC(src, 1) - ROC de 1 período (não 35!)
 * 2. EMA(firstLength=35) no ROC de 1 período
 * 3. Multiplica por 10
 * 4. EMA(secondLength=20) no resultado multiplicado
 * 5. PMO = resultado final
 * 
 * Parâmetros padrão: firstLength=35, secondLength=20, signalLength=10
 */
export function calculatePMO(
  closes: number[],
  firstLength: number = 35,
  secondLength: number = 20
): number | null {
  // Precisa de candles suficientes: pelo menos firstLength + secondLength
  if (closes.length < firstLength + secondLength + 10) {
    return null;
  }

  // 1. Calcular ROC de 1 período (não firstLength!)
  const roc1: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    // nz() substitui NaN por 0 (conforme Pine Script)
    roc1.push(isNaN(change) ? 0 : change);
  }

  if (roc1.length < firstLength) {
    return null;
  }

   // 2. 1ª suavização custom: EMA com alpha = 2/length1 (TradingView/DecisionPoint usa 2/length, não 2/(length+1))
   const alpha1 = 2 / firstLength;
   const ema1: number[] = [];
   let prev1: number | null = null;
   
   for (let i = 0; i < roc1.length; i++) {
     const x = roc1[i];
     if (prev1 == null) {
       prev1 = x; // seed (igual ao primeiro valor disponível)
     } else {
       prev1 = alpha1 * x + (1 - alpha1) * prev1;
     }
     ema1.push(prev1);
   }

  if (ema1.length < secondLength) {
    return null;
  }

  // 3. Multiplicar por 10
  const multiplied = ema1.map(v => v * 10);

    // 4. 2ª suavização custom: EMA com alpha = 2/length2 (TradingView/DecisionPoint usa 2/length, não 2/(length+1))
    const alpha2 = 2 / secondLength;
    const ema2: number[] = [];
    let prev2: number | null = null;
    
    for (let i = 0; i < multiplied.length; i++) {
      const x = multiplied[i];
      if (prev2 == null) {
        prev2 = x; // seed (igual ao primeiro valor disponível)
      } else {
        prev2 = alpha2 * x + (1 - alpha2) * prev2;
      }
      ema2.push(prev2);
    }

  if (ema2.length === 0) {
    return null;
  }

  // 5. PMO = último valor da segunda EMA
  const pmo = ema2[ema2.length - 1];

  return pmo;
}

/**
 * Calcula Bollinger Bands
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) {
    return null;
  }

  const bbValues = BollingerBands.calculate({
    values: closes,
    period: period,
    stdDev: stdDev,
  });

  if (bbValues.length === 0) {
    return null;
  }

  const last = bbValues[bbValues.length - 1];
  return {
    upper: last.upper || 0,
    middle: last.middle || 0,
    lower: last.lower || 0,
  };
}

/**
 * Calcula Donchian Channel (usando highest high e lowest low)
 * Retorna upper/lower (padrão) e também high/low (compatibilidade)
 */
export function calculateDonchianAt(
  candles: Candle[],
  period: number = 20,
  index: number = -1
): { upper: number; middle: number; lower: number; high: number; low: number } | null {
  if (candles.length < period) {
    return null;
  }

  // Se index é negativo, usa o último período
  const startIdx = index < 0 ? Math.max(0, candles.length + index - period + 1) : index;
  const endIdx = startIdx + period;

  if (endIdx > candles.length) {
    return null;
  }

  const slice = candles.slice(startIdx, endIdx);
  const upper = getHighestHigh(slice, period);
  const lower = getLowestLow(slice, period);
  const middle = (upper + lower) / 2;

  return { 
    upper, 
    middle, 
    lower,
    high: upper,  // Alias para compatibilidade
    low: lower    // Alias para compatibilidade
  };
}