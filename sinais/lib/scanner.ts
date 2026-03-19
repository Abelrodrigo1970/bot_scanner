/**
 * Scanner de Trades A+ para Binance USDT-M Futures Perpetual
 * Implementa setups TREND_PULLBACK e BREAKOUT_RETEST
 */

import { fetchCandles, fetchTopSymbolsByVolume, type Candle } from './marketData';
import {
  calculateEMA,
  calculateATR,
  calculateRSI,
  calculateVolumeMA,
  getCloses,
  getVolumes,
  getHighestHigh,
  getLowestLow,
} from './indicators';

export interface ScannerConfig {
  topSymbolsLimit?: number;
  minQuoteVolume?: number;
  minATRPercent?: number;
  maxATRPercent?: number;
  minScore?: number;
  topResultsLimit?: number;
  enableBreakoutRetest?: boolean;
  breakoutLookback?: number;
  cooldownMinutes?: number;
}

export interface ScannerAlert {
  symbol: string;
  side: 'LONG' | 'SHORT';
  setup: 'TREND_PULLBACK' | 'BREAKOUT_RETEST';
  alert_type: 'PRE_SETUP' | 'ENTRY';
  timeframe: string;
  score: number;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  atr_pct_15m: number;
  reasons: string[];
  timestamp: number;
}

interface IndicatorData {
  ema200_1h: number | null;
  ema200_1h_10barsAgo: number | null;
  ema21_1h: number | null;
  ema21_15m: number | null;
  atr14_1h: number | null;
  atr14_15m: number | null;
  rsi14_15m: number | null;
  volumeMA20_15m: number | null;
  currentPrice1h: number; // Preço 1H para verificar regime
  currentPrice15m: number; // Preço 15m para entry
  currentVolume: number;
}

/**
 * Busca candles e calcula todos os indicadores necessários
 */
async function fetchAndCalculateIndicators(
  symbol: string
): Promise<{
  candles1h: Candle[];
  candles15m: Candle[];
  indicators: IndicatorData;
} | null> {
  try {
    // Buscar candles
    const candles1h = await fetchCandles(symbol, '1h', 300);
    const candles15m = await fetchCandles(symbol, '15m', 300);

    if (candles1h.length < 300 || candles15m.length < 300) {
      return null;
    }

    const closes1h = getCloses(candles1h);
    const closes15m = getCloses(candles15m);
    const volumes15m = getVolumes(candles15m);

    // Calcular indicadores 1H
    const ema200_1h_values = calculateEMA(closes1h, 200);
    const ema21_1h_values = calculateEMA(closes1h, 21);
    const atr14_1h = calculateATR(candles1h, 14);

    // Calcular indicadores 15m
    const ema21_15m_values = calculateEMA(closes15m, 21);
    const atr14_15m = calculateATR(candles15m, 14);
    const rsi14_15m = calculateRSI(closes15m, 14);
    const volumeMA20_15m = calculateVolumeMA(volumes15m, 20);

    if (
      !ema200_1h_values ||
      !ema21_1h_values ||
      !ema21_15m_values ||
      atr14_1h === null ||
      atr14_15m === null ||
      rsi14_15m === null ||
      volumeMA20_15m === null
    ) {
      return null;
    }

    const ema200_1h = ema200_1h_values[ema200_1h_values.length - 1];
    const ema200_1h_10barsAgo =
      ema200_1h_values.length >= 10
        ? ema200_1h_values[ema200_1h_values.length - 10]
        : null;
    const ema21_1h = ema21_1h_values[ema21_1h_values.length - 1];
    const ema21_15m = ema21_15m_values[ema21_15m_values.length - 1];
    const currentPrice1h = candles1h[candles1h.length - 1].close; // Preço 1H para regime
    const currentPrice15m = candles15m[candles15m.length - 1].close; // Preço 15m para entry
    const currentVolume = candles15m[candles15m.length - 1].volume;

    return {
      candles1h,
      candles15m,
      indicators: {
        ema200_1h,
        ema200_1h_10barsAgo,
        ema21_1h,
        ema21_15m,
        atr14_1h,
        atr14_15m,
        rsi14_15m,
        volumeMA20_15m,
        currentPrice1h,
        currentPrice15m,
        currentVolume,
      },
    };
  } catch (error) {
    console.error(`Erro ao calcular indicadores para ${symbol}:`, error);
    return null;
  }
}

/**
 * Verifica se o regime (1H) permite LONG ou SHORT
 */
function checkRegime(indicators: IndicatorData): {
  longAllowed: boolean;
  shortAllowed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  let longAllowed = false;
  let shortAllowed = false;

  const { ema200_1h, ema200_1h_10barsAgo, currentPrice1h } = indicators;

  if (ema200_1h === null || ema200_1h_10barsAgo === null) {
    return { longAllowed: false, shortAllowed: false, reasons };
  }

  // LONG permitido se: Close(1H) > EMA200(1H) e EMA200 inclinada para cima
  if (currentPrice1h > ema200_1h) {
    if (ema200_1h > ema200_1h_10barsAgo) {
      longAllowed = true;
      reasons.push('1H>EMA200', 'EMA200 slope up');
    } else {
      reasons.push('1H>EMA200 but EMA200 slope down');
    }
  }

  // SHORT permitido se: Close(1H) < EMA200(1H) e EMA200 inclinada para baixo
  if (currentPrice1h < ema200_1h) {
    if (ema200_1h < ema200_1h_10barsAgo) {
      shortAllowed = true;
      reasons.push('1H<EMA200', 'EMA200 slope down');
    } else {
      reasons.push('1H<EMA200 but EMA200 slope up');
    }
  }

  return { longAllowed, shortAllowed, reasons };
}

/**
 * Verifica se o preço está na zona (próximo da EMA21 1H)
 */
function checkZone(indicators: IndicatorData): {
  inZone: boolean;
  reasons: string[];
} {
  const { ema21_1h, atr14_1h, currentPrice1h } = indicators;
  const reasons: string[] = [];

  if (ema21_1h === null || atr14_1h === null) {
    return { inZone: false, reasons };
  }

  const distance = Math.abs(currentPrice1h - ema21_1h);
  const threshold = 0.5 * atr14_1h;

  if (distance <= threshold) {
    reasons.push('near EMA21 1H');
    return { inZone: true, reasons };
  }

  return { inZone: false, reasons };
}

/**
 * Calcula stop loss baseado em estrutura e ATR
 */
function calculateStop(
  candles15m: Candle[],
  side: 'LONG' | 'SHORT',
  atr14_15m: number,
  currentPrice: number
): number {
  // Stop por estrutura: swing high/low dos últimos 10 candles
  const lookback = Math.min(10, candles15m.length);
  const recentCandles = candles15m.slice(-lookback);

  let structureStop: number;

  if (side === 'LONG') {
    // Para LONG, stop abaixo do swing low
    structureStop = getLowestLow(recentCandles, lookback);
  } else {
    // Para SHORT, stop acima do swing high
    structureStop = getHighestHigh(recentCandles, lookback);
  }

  // Stop por ATR
  const atrStop =
    side === 'LONG'
      ? currentPrice - 1.2 * atr14_15m
      : currentPrice + 1.2 * atr14_15m;

  // Retornar o mais conservador (mais distante da entrada)
  if (side === 'LONG') {
    return Math.min(structureStop, atrStop);
  } else {
    return Math.max(structureStop, atrStop);
  }
}

/**
 * Calcula targets T1 e T2 baseados em R:R
 */
function calculateTargets(
  entry: number,
  stop: number,
  side: 'LONG' | 'SHORT'
): { t1: number; t2: number } {
  const risk = Math.abs(entry - stop);

  if (side === 'LONG') {
    return {
      t1: entry + risk, // 1R
      t2: entry + 2 * risk, // 2R
    };
  } else {
    return {
      t1: entry - risk, // 1R
      t2: entry - 2 * risk, // 2R
    };
  }
}

/**
 * Calcula score do sinal (0-10)
 */
function calculateScore(
  indicators: IndicatorData,
  regime: { longAllowed: boolean; shortAllowed: boolean },
  inZone: boolean,
  trigger: boolean,
  volumeOk: boolean,
  rrOk: boolean
): number {
  let score = 0;

  // +2 regime forte
  if (regime.longAllowed || regime.shortAllowed) {
    score += 2;
  }

  // +2 zona limpa
  if (inZone) {
    score += 2;
  }

  // +2 gatilho claro
  if (trigger) {
    score += 2;
  }

  // +2 volume acima da média
  if (volumeOk) {
    score += 2;
  }

  // +2 R:R >= 2
  if (rrOk) {
    score += 2;
  }

  return score;
}

/**
 * Detecta setup TREND_PULLBACK
 */
function detectTrendPullback(
  candles1h: Candle[],
  candles15m: Candle[],
  indicators: IndicatorData,
  config: ScannerConfig
): ScannerAlert | null {
  const regime = checkRegime(indicators);
  const zone = checkZone(indicators);

    const {
      ema21_1h,
      ema21_15m,
      atr14_15m,
      rsi14_15m,
      volumeMA20_15m,
      currentPrice15m,
      currentVolume,
    } = indicators;

  if (ema21_1h === null || ema21_15m === null || atr14_15m === null) {
    return null;
  }

  const atrPercent = (atr14_15m / currentPrice15m) * 100;
  const minATR = config.minATRPercent || 0.3;
  const maxATR = config.maxATRPercent || 2.5;

  // Filtro de volatilidade
  if (atrPercent < minATR || atrPercent > maxATR) {
    return null;
  }

  const lastCandle15m = candles15m[candles15m.length - 1];
  const volumeOk = currentVolume > (volumeMA20_15m || 0);

  // PRE-SETUP: Regime OK + na zona + volatilidade OK
  if (
    (regime.longAllowed || regime.shortAllowed) &&
    zone.inZone &&
    atrPercent >= minATR &&
    atrPercent <= maxATR
  ) {
    // Verificar se há gatilho para ENTRY
    let entry: number | null = null;
    let side: 'LONG' | 'SHORT' | null = null;
    let trigger = false;
    const reasons: string[] = [...regime.reasons, ...zone.reasons];

    // LONG entry
    if (
      regime.longAllowed &&
      lastCandle15m.close > ema21_15m &&
      volumeOk &&
      (rsi14_15m === null || rsi14_15m <= 72)
    ) {
      entry = currentPrice15m;
      side = 'LONG';
      trigger = true;
      reasons.push('15m close>EMA21', 'vol>MA20', 'RSI not overbought');
    }

    // SHORT entry
    if (
      regime.shortAllowed &&
      lastCandle15m.close < ema21_15m &&
      volumeOk &&
      (rsi14_15m === null || rsi14_15m >= 28)
    ) {
      entry = currentPrice15m;
      side = 'SHORT';
      trigger = true;
      reasons.push('15m close<EMA21', 'vol>MA20', 'RSI not oversold');
    }

    if (entry && side) {
      const stop = calculateStop(candles15m, side, atr14_15m, entry);
      const targets = calculateTargets(entry, stop, side);
      const risk = Math.abs(entry - stop);
      const reward = Math.abs(targets.t2 - entry);
      const rrOk = reward >= 2 * risk;

      const score = calculateScore(
        indicators,
        regime,
        zone.inZone,
        trigger,
        volumeOk,
        rrOk
      );

      if (rrOk) {
        reasons.push('RR>=2');
      }

      const alertType: 'PRE_SETUP' | 'ENTRY' = trigger ? 'ENTRY' : 'PRE_SETUP';

      return {
        symbol: '', // Será preenchido depois
        side,
        setup: 'TREND_PULLBACK',
        alert_type: alertType,
        timeframe: '15m',
        score,
        entry,
        stop,
        t1: targets.t1,
        t2: targets.t2,
        atr_pct_15m: atrPercent,
        reasons,
        timestamp: Date.now(),
      };
    } else if (regime.longAllowed || regime.shortAllowed) {
      // Apenas PRE-SETUP (na zona mas sem gatilho)
      return {
        symbol: '', // Será preenchido depois
        side: regime.longAllowed ? 'LONG' : 'SHORT',
        setup: 'TREND_PULLBACK',
        alert_type: 'PRE_SETUP',
        timeframe: '15m',
        score: 4, // Score menor para PRE-SETUP
        entry: currentPrice15m,
        stop: 0, // Será calculado quando houver gatilho
        t1: 0,
        t2: 0,
        atr_pct_15m: atrPercent,
        reasons: [...regime.reasons, ...zone.reasons],
        timestamp: Date.now(),
      };
    }
  }

  return null;
}

/**
 * Detecta setup BREAKOUT_RETEST
 */
function detectBreakoutRetest(
  candles1h: Candle[],
  candles15m: Candle[],
  indicators: IndicatorData,
  config: ScannerConfig
): ScannerAlert | null {
  const regime = checkRegime(indicators);
  const lookback = config.breakoutLookback || 48;

  if (candles15m.length < lookback + 5) {
    return null;
  }

    const {
      ema21_15m,
      atr14_15m,
      rsi14_15m,
      volumeMA20_15m,
      currentPrice15m,
      currentVolume,
    } = indicators;

  if (ema21_15m === null || atr14_15m === null) {
    return null;
  }

  const atrPercent = (atr14_15m / currentPrice15m) * 100;
  const minATR = config.minATRPercent || 0.3;
  const maxATR = config.maxATRPercent || 2.5;

  if (atrPercent < minATR || atrPercent > maxATR) {
    return null;
  }

  const recentCandles = candles15m.slice(-lookback);
  const breakoutHigh = getHighestHigh(recentCandles, lookback);
  const breakoutLow = getLowestLow(recentCandles, lookback);

  const lastCandle = candles15m[candles15m.length - 1];
  const prevCandle = candles15m[candles15m.length - 2];

  const volumeOk = currentVolume > (volumeMA20_15m || 0);
  const tolerance = 0.3 * atr14_15m;

  // LONG: Breakout acima + reteste
  if (
    regime.longAllowed &&
    lastCandle.close > breakoutHigh &&
    lastCandle.high > prevCandle.high &&
    volumeOk
  ) {
    // Verificar reteste
    const retestCandles = candles15m.slice(-5);
    const retestLow = getLowestLow(retestCandles, 5);

    if (
      retestLow <= breakoutHigh + tolerance &&
      retestLow >= breakoutHigh - tolerance &&
      lastCandle.close > breakoutHigh
        ) {
          const entry = currentPrice15m;
          const stop = calculateStop(candles15m, 'LONG', atr14_15m, entry);
      const targets = calculateTargets(entry, stop, 'LONG');
      const risk = Math.abs(entry - stop);
      const reward = Math.abs(targets.t2 - entry);
      const rrOk = reward >= 2 * risk;

      const score = calculateScore(
        indicators,
        regime,
        false,
        true,
        volumeOk,
        rrOk
      );

      return {
        symbol: '', // Será preenchido depois
        side: 'LONG',
        setup: 'BREAKOUT_RETEST',
        alert_type: 'ENTRY',
        timeframe: '15m',
        score,
        entry,
        stop,
        t1: targets.t1,
        t2: targets.t2,
        atr_pct_15m: atrPercent,
        reasons: [
          'breakout above resistance',
          'retest confirmed',
          'vol>MA20',
          rrOk ? 'RR>=2' : '',
        ].filter(Boolean),
        timestamp: Date.now(),
      };
    }
  }

  // SHORT: Breakout abaixo + reteste
  if (
    regime.shortAllowed &&
    lastCandle.close < breakoutLow &&
    lastCandle.low < prevCandle.low &&
    volumeOk
  ) {
    // Verificar reteste
    const retestCandles = candles15m.slice(-5);
    const retestHigh = getHighestHigh(retestCandles, 5);

    if (
      retestHigh >= breakoutLow - tolerance &&
      retestHigh <= breakoutLow + tolerance &&
      lastCandle.close < breakoutLow
        ) {
          const entry = currentPrice15m;
          const stop = calculateStop(candles15m, 'SHORT', atr14_15m, entry);
      const targets = calculateTargets(entry, stop, 'SHORT');
      const risk = Math.abs(entry - stop);
      const reward = Math.abs(targets.t2 - entry);
      const rrOk = reward >= 2 * risk;

      const score = calculateScore(
        indicators,
        regime,
        false,
        true,
        volumeOk,
        rrOk
      );

      return {
        symbol: '', // Será preenchido depois
        side: 'SHORT',
        setup: 'BREAKOUT_RETEST',
        alert_type: 'ENTRY',
        timeframe: '15m',
        score,
        entry,
        stop,
        t1: targets.t1,
        t2: targets.t2,
        atr_pct_15m: atrPercent,
        reasons: [
          'breakout below support',
          'retest confirmed',
          'vol>MA20',
          rrOk ? 'RR>=2' : '',
        ].filter(Boolean),
        timestamp: Date.now(),
      };
    }
  }

  return null;
}

/**
 * Função principal do scanner
 */
export async function runScanner(
  config: ScannerConfig = {}
): Promise<{
  entries: ScannerAlert[];
  preSetups: ScannerAlert[];
}> {
  const {
    topSymbolsLimit = 50,
    minQuoteVolume = 0,
    minScore = 7,
    topResultsLimit = 3,
    enableBreakoutRetest = false,
    cooldownMinutes = 60,
  } = config;

  const entries: ScannerAlert[] = [];
  const preSetups: ScannerAlert[] = [];
  const recentAlerts = new Map<string, number>(); // symbol -> timestamp

  try {
    // Buscar top símbolos
    const symbols = await fetchTopSymbolsByVolume(topSymbolsLimit, minQuoteVolume);
    console.log(`Analisando ${symbols.length} símbolos...`);

    // Processar cada símbolo
    for (const symbol of symbols) {
      try {
        // Verificar cooldown
        const lastAlert = recentAlerts.get(symbol);
        if (lastAlert && Date.now() - lastAlert < cooldownMinutes * 60 * 1000) {
          continue;
        }

        // Buscar e calcular indicadores
        const data = await fetchAndCalculateIndicators(symbol);
        if (!data) {
          continue;
        }

        const { candles1h, candles15m, indicators } = data;

        // Detectar TREND_PULLBACK
        const trendPullback = detectTrendPullback(
          candles1h,
          candles15m,
          indicators,
          config
        );

        if (trendPullback) {
          trendPullback.symbol = symbol;

          if (trendPullback.alert_type === 'ENTRY' && trendPullback.score >= minScore) {
            entries.push(trendPullback);
            recentAlerts.set(symbol, Date.now());
          } else if (trendPullback.alert_type === 'PRE_SETUP') {
            preSetups.push(trendPullback);
          }
        }

        // Detectar BREAKOUT_RETEST (se habilitado)
        if (enableBreakoutRetest) {
          const breakoutRetest = detectBreakoutRetest(
            candles1h,
            candles15m,
            indicators,
            config
          );

          if (
            breakoutRetest &&
            breakoutRetest.score >= minScore &&
            breakoutRetest.alert_type === 'ENTRY'
          ) {
            breakoutRetest.symbol = symbol;
            entries.push(breakoutRetest);
            recentAlerts.set(symbol, Date.now());
          }
        }

        // Delay para não sobrecarregar API
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Erro ao processar ${symbol}:`, error);
        continue;
      }
    }

    // Ordenar por score e retornar top N
    entries.sort((a, b) => b.score - a.score);
    const topEntries = entries.slice(0, topResultsLimit);

    return {
      entries: topEntries,
      preSetups: preSetups.slice(0, 10), // Top 10 PRE-SETUP
    };
  } catch (error) {
    console.error('Erro ao executar scanner:', error);
    throw error;
  }
}

/**
 * Calcula tamanho de posição baseado em risco
 */
export function calculatePositionSize(
  balance: number,
  riskPercent: number,
  entry: number,
  stop: number
): number {
  const riskUSDT = balance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entry - stop);
  const qty = riskUSDT / riskPerUnit;
  return Math.max(0, qty);
}

