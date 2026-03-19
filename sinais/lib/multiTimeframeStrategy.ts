/**
 * Estratégia Multi-Timeframe (4H + 1H)
 * 
 * Implementa:
 * - Filtro 4H (regime RANGE/TREND + bias BULL/BEAR/NEUTRAL)
 * - Entradas RANGE (Bollinger Bands)
 * - Entradas TREND (Breakout + Reteste com Donchian)
 */

import type { Candle } from './marketData';
import {
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateBollingerBands,
  calculateDonchianAt,
  calculateVolumeMA,
  getCloses,
  getVolumes,
} from './indicators';

export interface EntrySignal {
  type: 'LONG' | 'SHORT' | 'NONE';
  reason: string;
  regime4H: 'RANGE' | 'TREND';
  bias4H: 'BULL' | 'BEAR' | 'NEUTRAL';
}

interface PendingSignal {
  level: number;
  expires: number; // índice 1H onde expira
}

interface MultiTimeframeState {
  pendingLong: PendingSignal | null;
  pendingShort: PendingSignal | null;
}

/**
 * Mapeia índice 1H para índice 4H (último candle 4H fechado)
 */
function map1Hto4H(i1H: number): number {
  // Cada candle 4H contém 4 candles 1H
  // O último 4H fechado está em floor((i1H - 1) / 4)
  return Math.floor((i1H - 1) / 4);
}

/**
 * Factory para criar a função de avaliação de sinais multi-timeframe
 */
export function createEntrySignals(
  candles1H: Candle[],
  candles4H: Candle[]
): {
  evaluate: (i1H: number) => EntrySignal;
} {
  const state: MultiTimeframeState = {
    pendingLong: null,
    pendingShort: null,
  };

  const evaluate = (i1H: number): EntrySignal => {
    // Warmup mínimo
    if (i1H < 100 || candles4H.length < 60) {
      return {
        type: 'NONE',
        reason: 'Warmup insuficiente',
        regime4H: 'RANGE',
        bias4H: 'NEUTRAL',
      };
    }

    // Verificar se i1H é válido
    if (i1H >= candles1H.length) {
      return {
        type: 'NONE',
        reason: 'Índice 1H inválido',
        regime4H: 'RANGE',
        bias4H: 'NEUTRAL',
      };
    }

    // Mapear para índice 4H
    const i4H = map1Hto4H(i1H);
    if (i4H < 0 || i4H >= candles4H.length) {
      return {
        type: 'NONE',
        reason: 'Índice 4H inválido',
        regime4H: 'RANGE',
        bias4H: 'NEUTRAL',
      };
    }

    // ===== 1) FILTRO 4H (regime + bias) =====
    const closes4H = getCloses(candles4H.slice(0, i4H + 1));
    const candle4H = candles4H[i4H];
    const close4H = candle4H.close;

    // Calcular indicadores 4H
    const ema20_4H_values = calculateEMA(closes4H, 20);
    const ema50_4H_values = calculateEMA(closes4H, 50);
    const rsi14_4H = calculateRSI(closes4H, 14);

    if (
      !ema20_4H_values ||
      !ema50_4H_values ||
      ema20_4H_values.length === 0 ||
      ema50_4H_values.length === 0 ||
      rsi14_4H === null
    ) {
      return {
        type: 'NONE',
        reason: 'Indicadores 4H insuficientes',
        regime4H: 'RANGE',
        bias4H: 'NEUTRAL',
      };
    }

    // EMA retorna array completo, pegar o último valor
    const ema20_4H = ema20_4H_values[ema20_4H_values.length - 1];
    const ema50_4H = ema50_4H_values[ema50_4H_values.length - 1];

    // Bollinger Bands 4H
    const bb4H = calculateBollingerBands(closes4H.slice(0, i4H + 1), 20, 2);
    if (!bb4H) {
      return {
        type: 'NONE',
        reason: 'Bollinger Bands 4H insuficientes',
        regime4H: 'RANGE',
        bias4H: 'NEUTRAL',
      };
    }

    const bbWidth4H = (bb4H.upper - bb4H.lower) / bb4H.middle;
    const trendSep4H = Math.abs(ema20_4H - ema50_4H) / close4H;

    // Determinar regime 4H
    const regime4H: 'RANGE' | 'TREND' =
      bbWidth4H < 0.05 && trendSep4H < 0.003 ? 'RANGE' : 'TREND';

    // Determinar bias 4H
    let bias4H: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
    if (
      close4H > ema50_4H &&
      ema20_4H > ema50_4H &&
      rsi14_4H >= 50
    ) {
      bias4H = 'BULL';
    } else if (
      close4H < ema50_4H &&
      ema20_4H < ema50_4H &&
      rsi14_4H <= 50
    ) {
      bias4H = 'BEAR';
    }

    // Verificar permissões baseadas em regime e bias
    if (regime4H === 'TREND') {
      if (bias4H === 'NEUTRAL') {
        return {
          type: 'NONE',
          reason: 'Regime TREND com bias NEUTRAL',
          regime4H,
          bias4H,
        };
      }
    }

    // Limpar pending expirados
    if (state.pendingLong && i1H > state.pendingLong.expires) {
      state.pendingLong = null;
    }
    if (state.pendingShort && i1H > state.pendingShort.expires) {
      state.pendingShort = null;
    }

    // ===== 2) ENTRADAS no 1H =====
    const candle1H = candles1H[i1H];
    const closes1H = getCloses(candles1H.slice(0, i1H + 1));
    const volumes1H = getVolumes(candles1H.slice(0, i1H + 1));

    // Calcular indicadores 1H
    const bb1H = calculateBollingerBands(closes1H, 20, 2);
    const rsi1H = calculateRSI(closes1H, 14);
    const atr1H = calculateATR(candles1H.slice(0, i1H + 1), 14);
    const volSma1H = calculateVolumeMA(volumes1H, 20);
    const ema50_1H_values = calculateEMA(closes1H, 50);
    const donchian1H = calculateDonchianAt(candles1H, 20, i1H);

    if (
      !bb1H ||
      rsi1H === null ||
      atr1H === null ||
      volSma1H === null ||
      !ema50_1H_values ||
      ema50_1H_values.length === 0 ||
      !donchian1H
    ) {
      return {
        type: 'NONE',
        reason: 'Indicadores 1H insuficientes',
        regime4H,
        bias4H,
      };
    }

    // EMA retorna array completo, pegar o último valor
    const ema50_1H = ema50_1H_values[ema50_1H_values.length - 1];
    const volume1H = candle1H.volume;

    // 2A) Entradas em RANGE
    if (regime4H === 'RANGE') {
      // LONG_RANGE
      if (
        candle1H.low <= bb1H.lower &&
        candle1H.close > bb1H.lower &&
        rsi1H < 35 &&
        volume1H > volSma1H * 1.1 &&
        (candle1H.close >= ema50_1H ||
          (candle1H.high - candle1H.low > 0 &&
            (candle1H.close - candle1H.open) / (candle1H.high - candle1H.low) >
              0.5))
      ) {
        return {
          type: 'LONG',
          reason: 'LONG_RANGE: Rejeição na banda inferior BB',
          regime4H,
          bias4H,
        };
      }

      // SHORT_RANGE
      if (
        candle1H.high >= bb1H.upper &&
        candle1H.close < bb1H.upper &&
        rsi1H > 65 &&
        volume1H > volSma1H * 1.1 &&
        (candle1H.close <= ema50_1H ||
          (candle1H.high - candle1H.low > 0 &&
            (candle1H.open - candle1H.close) / (candle1H.high - candle1H.low) >
              0.5))
      ) {
        return {
          type: 'SHORT',
          reason: 'SHORT_RANGE: Rejeição na banda superior BB',
          regime4H,
          bias4H,
        };
      }
    }

    // 2B) Entradas em TREND (Breakout + Reteste)
    if (regime4H === 'TREND') {
      // Detectar BREAKOUT (não entra ainda, cria pending)
      if (bias4H === 'BULL' && !state.pendingLong) {
        if (
          candle1H.close > donchian1H.high &&
          volume1H > volSma1H * 1.5 &&
          rsi1H > 50
        ) {
          state.pendingLong = {
            level: donchian1H.high,
            expires: i1H + 6,
          };
          return {
            type: 'NONE',
            reason: 'Breakout LONG detectado, aguardando reteste',
            regime4H,
            bias4H,
          };
        }
      }

      if (bias4H === 'BEAR' && !state.pendingShort) {
        if (
          candle1H.close < donchian1H.low &&
          volume1H > volSma1H * 1.5 &&
          rsi1H < 50
        ) {
          state.pendingShort = {
            level: donchian1H.low,
            expires: i1H + 6,
          };
          return {
            type: 'NONE',
            reason: 'Breakout SHORT detectado, aguardando reteste',
            regime4H,
            bias4H,
          };
        }
      }

      // Confirmar RETESTE (aqui entra)
      if (state.pendingLong) {
        if (
          candle1H.low <= state.pendingLong.level * 1.003 &&
          candle1H.close > state.pendingLong.level
        ) {
          state.pendingLong = null; // Limpar após entrada
          return {
            type: 'LONG',
            reason: 'LONG_RETEST: Reteste após breakout',
            regime4H,
            bias4H,
          };
        }
      }

      if (state.pendingShort) {
        if (
          candle1H.high >= state.pendingShort.level * 0.997 &&
          candle1H.close < state.pendingShort.level
        ) {
          state.pendingShort = null; // Limpar após entrada
          return {
            type: 'SHORT',
            reason: 'SHORT_RETEST: Reteste após breakout',
            regime4H,
            bias4H,
          };
        }
      }
    }

    return {
      type: 'NONE',
      reason: 'Nenhuma condição de entrada atendida',
      regime4H,
      bias4H,
    };
  };

  return { evaluate };
}

