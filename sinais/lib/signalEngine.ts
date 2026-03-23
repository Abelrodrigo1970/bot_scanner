/**
 * Motor de geração de sinais - RSI + Volume Spike
 */

import { prisma } from './db';
import { fetchCandles, fetchTopSymbolsBy1hPriceChange, fetchTopSymbolsBy24hPriceChange, type Timeframe } from './marketData';
import {
  calculateRSI,
  calculateSMA,
  getCloses,
  getVolumes,
  calculateVolumeMA,
} from './indicators';

export interface SignalResult {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  target3?: number;
  strength: number;
  extraInfo: string;
}

export interface StrategyParams {
  [key: string]: any;
}

/**
 * Estratégia Volume Spike: Gera sinais quando volume é maior que 12 vezes a média das últimas 20 horas
 * Timeframe 1h - analisa volume das últimas 20 horas
 */
export async function runVolumeSpikeStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') {
    return null;
  }

  const configuredMultiplier = Number(params.volumeMultiplier ?? 12);
  const volumeMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? Math.max(12, configuredMultiplier)
    : 12;
  const lookbackHours = params.lookbackHours || 20;

  try {
    const candlesNeeded = lookbackHours + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);

    if (candles.length < lookbackHours + 2) {
      return null;
    }

    const volumes = getVolumes(candles);
    const lastClosedIndex = volumes.length - 2;
    const currentVolume = volumes[lastClosedIndex];

    const volumesForAverage = volumes.slice(-lookbackHours - 2, -2);
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackHours);

    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    const volumeRatio = currentVolume / volumeAverage;

    if (volumeRatio < volumeMultiplier) {
      return null;
    }

    const currentPrice = candles[lastClosedIndex].close;
    const prevPrice = candles[lastClosedIndex - 1].close;
    const priceChange = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    if (direction === 'BUY') {
      const stopLoss = currentPrice * 0.87;
      const target1 = currentPrice * 1.09;
      const target2 = currentPrice * 1.25;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackHours,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    } else {
      const stopLoss = currentPrice * 1.13;
      const target1 = currentPrice * 0.91;
      const target2 = currentPrice * 0.75;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackHours,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    }
  } catch (error) {
    console.error(`Erro na estratégia Volume Spike para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia Volume Spike 15m: igual ao Volume Spike 1h mas em 15m com 15 períodos
 */
export async function runVolumeSpike15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') {
    return null;
  }

  const configuredMultiplier = Number(params.volumeMultiplier ?? 12);
  const volumeMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? Math.max(12, configuredMultiplier)
    : 12;
  const lookbackPeriods = params.lookbackPeriods ?? 15;

  try {
    const candlesNeeded = lookbackPeriods + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);

    if (candles.length < lookbackPeriods + 2) {
      return null;
    }

    const volumes = getVolumes(candles);
    const lastClosedIndex = volumes.length - 2;
    const currentVolume = volumes[lastClosedIndex];

    const volumesForAverage = volumes.slice(-lookbackPeriods - 2, -2);
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackPeriods);

    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    const volumeRatio = currentVolume / volumeAverage;
    if (volumeRatio < volumeMultiplier) {
      return null;
    }

    const currentPrice = candles[lastClosedIndex].close;
    const prevPrice = candles[lastClosedIndex - 1].close;
    const priceChange = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    if (direction === 'BUY') {
      const stopLoss = currentPrice * 0.87;
      const target1 = currentPrice * 1.09;
      const target2 = currentPrice * 1.25;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackPeriods,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    } else {
      const stopLoss = currentPrice * 1.13;
      const target1 = currentPrice * 0.91;
      const target2 = currentPrice * 0.75;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackPeriods,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    }
  } catch (error) {
    console.error(`Erro na estratégia Volume Spike 15m para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia MA Cross Top Voláteis:
 * Analisa apenas as 20 Top Voláteis da BD.
 * COMPRA: preço cruza MA60 para cima. Stop 10%, TP1 20% (30% posição), TP2 40% (40% posição).
 * VENDA: preço abaixo de MA60 e MA200 (cruzamento para baixo). Stop 10% ou cruzamento acima MA200. TP1 +10%, TP2 +20%.
 */
export async function runMa60VolatileStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const ma60Period = params.ma60Period ?? 60;
  const ma200Period = params.ma200Period ?? 200;
  const buyStopPercent = params.buyStopPercent ?? 10;
  const buyTp1Percent = params.buyTp1Percent ?? 20;
  const buyTp2Percent = params.buyTp2Percent ?? 40;
  const sellStopPercent = params.sellStopPercent ?? 10;
  const sellTp1Percent = params.sellTp1Percent ?? 10;
  const sellTp2Percent = params.sellTp2Percent ?? 20;

  try {
    const candlesNeeded = ma200Period + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < ma200Period + 2) return null;

    const closes = getCloses(candles);
    const ma60 = calculateSMA(closes, ma60Period);
    const ma200 = calculateSMA(closes, ma200Period);
    if (ma60 === null || ma200 === null) return null;

    // Valores do candle anterior para detectar cruzamento
    const prevCloses = closes.slice(0, -1);
    const prevMa60 = calculateSMA(prevCloses, ma60Period);
    const prevMa200 = calculateSMA(prevCloses, ma200Period);
    if (prevMa60 === null || prevMa200 === null) return null;

    const currentPrice = candles[candles.length - 1].close;
    const prevPrice = candles[candles.length - 2].close;

    // COMPRA: preço cruza MA60 para cima (prev <= MA60, agora > MA60)
    if (prevPrice <= prevMa60 && currentPrice > ma60) {
      const stopLoss = currentPrice * (1 - buyStopPercent / 100);
      const target1 = currentPrice * (1 + buyTp1Percent / 100);
      const target2 = currentPrice * (1 + buyTp2Percent / 100);

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma60: ma60.toFixed(4),
          ma200: ma200.toFixed(4),
          crossover: 'price crosses above MA60',
          stopPercent: buyStopPercent,
          tp1Percent: buyTp1Percent,
          tp2Percent: buyTp2Percent,
          tp1Position: '30%',
          tp2Position: '40%',
        }),
      };
    }

    // VENDA: preço cruza MA60 para baixo E preço abaixo de MA200
    if (prevPrice >= prevMa60 && currentPrice < ma60 && currentPrice < ma200) {
      const stopLoss = currentPrice * (1 + sellStopPercent / 100);
      const target1 = currentPrice * (1 - sellTp1Percent / 100);
      const target2 = currentPrice * (1 - sellTp2Percent / 100);

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3: undefined,
        strength: 70,
        extraInfo: JSON.stringify({
          ma60: ma60.toFixed(4),
          ma200: ma200.toFixed(4),
          crossover: 'price crosses below MA60, below MA200',
          stopPercent: sellStopPercent,
          exitOnMa200Cross: 'close when price crosses above MA200',
          tp1Percent: sellTp1Percent,
          tp2Percent: sellTp2Percent,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MA Voláteis para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia RSI (invertida / momentum):
 * COMPRA quando RSI sobe acima de 69 (cruzamento) E preço > MA200
 * VENDA quando RSI desce abaixo de 29 (cruzamento) E preço < MA200
 * Stop 10%, TP1 35% posição @ 9%, TP2 35% posição @ 24%, TP3 30% às 24h
 */
export async function runRsiStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const period = params.period || 14;
  const buyThreshold = params.buyThreshold ?? 69;   // Compra quando sobe acima
  const sellThreshold = params.sellThreshold ?? 29; // Vende quando desce abaixo
  const maPeriod = params.maPeriod ?? 200;

  try {
    const candlesNeeded = Math.max(period + 25, maPeriod + 5);
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < period + 3 || candles.length < maPeriod) return null;

    const closes = getCloses(candles);
    const rsi = calculateRSI(closes, period);
    const prevCloses = closes.slice(0, -1);
    const prevRsi = calculateRSI(prevCloses, period);
    const ma200 = calculateSMA(closes, maPeriod);
    if (rsi === null || prevRsi === null || ma200 === null) return null;

    const currentPrice = candles[candles.length - 1].close;

    // COMPRA: RSI sobe acima de 69 (cruzamento) E preço acima da MA200
    if (prevRsi <= buyThreshold && rsi > buyThreshold && currentPrice > ma200) {
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice * 0.90,    // 10% stop
        target1: currentPrice * 1.09,     // TP1: 9% valorização, 35% posição
        target2: currentPrice * 1.24,     // TP2: 24% valorização, 35% posição
        target3: undefined,               // TP3: 30% restante às 24h
        strength: Math.min(100, Math.max(60, Math.round(60 + (rsi - buyThreshold) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsi.toFixed(2),
          prevRsi: prevRsi.toFixed(2),
          buyThreshold,
          ma200: ma200.toFixed(4),
          tp1Percent: 9,
          tp2Percent: 24,
          tp3Percent: '24h',
        }),
      };
    }

    // VENDA: RSI desce abaixo de 29 (cruzamento) E preço abaixo da MA200
    if (prevRsi >= sellThreshold && rsi < sellThreshold && currentPrice < ma200) {
      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss: currentPrice * 1.10,    // 10% stop
        target1: currentPrice * 0.91,     // TP1: 9% valorização, 35% posição
        target2: currentPrice * 0.76,     // TP2: 24% valorização, 35% posição
        target3: undefined,               // TP3: 30% restante às 24h
        strength: Math.min(100, Math.max(60, Math.round(60 + (sellThreshold - rsi) * 2))),
        extraInfo: JSON.stringify({
          rsi: rsi.toFixed(2),
          prevRsi: prevRsi.toFixed(2),
          sellThreshold,
          ma200: ma200.toFixed(4),
          tp1Percent: 9,
          tp2Percent: 24,
          tp3Percent: '24h',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia RSI para ${symbol}:`, error);
    return null;
  }
}

export interface RunAllStrategiesOptions {
  /** Estratégias a excluir (ex: ['VOLUME_SPIKE'] para cron separado) */
  exclude?: string[];
}

/**
 * Executa todas as estratégias ativas (RSI, Volume Spike 1h, Volume Spike 15m)
 */
export async function runAllStrategies(options?: RunAllStrategiesOptions): Promise<number> {
  let signalsCreated = 0;

  try {
    let strategies = await prisma.strategy.findMany({
      where: { isActive: true },
    });

    if (options?.exclude?.length) {
      strategies = strategies.filter((s) => !options!.exclude!.includes(s.name));
      console.log(`📋 Estratégias excluídas: ${options.exclude.join(', ')}`);
    }

    if (strategies.length === 0) {
      console.log('Nenhuma estratégia ativa encontrada');
      return 0;
    }

    console.log('🔍 Buscando símbolos por variação na última hora (Binance Futures)...');
    let symbols: string[] = [];
    try {
      symbols = await fetchTopSymbolsBy1hPriceChange(150, 250);
      console.log(`✅ Encontrados ${symbols.length} símbolos`);
    } catch (err) {
      console.error('Erro ao buscar símbolos, usando fallback:', err);
      symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
    }

    const timeframes: Timeframe[] = ['1h', '4h'];
    const unknownStrategiesLogged = new Set<string>();

    for (const strategy of strategies) {
      const params = JSON.parse(strategy.params || '{}');

      const timeframesToUse: Timeframe[] =
        strategy.name === 'VOLUME_SPIKE_15M' ? ['15m'] :
        strategy.name === 'MA_VOLATILE' ? ['1h'] : timeframes;

      let symbolsToAnalyze = symbols;
      if (strategy.name === 'VOLUME_SPIKE' || strategy.name === 'VOLUME_SPIKE_15M') {
        const maxSymbols = 500;
        const minQuoteVolume = 100000;
        console.log(`🔍 Buscando símbolos por % variação 24h para ${strategy.name}...`);
        const volumeSymbols = await fetchTopSymbolsBy24hPriceChange(maxSymbols, minQuoteVolume);
        if (volumeSymbols.length > 0) {
          symbolsToAnalyze = volumeSymbols;
          console.log(`✅ Encontrados ${volumeSymbols.length} símbolos`);
        }
      } else if (strategy.name === 'MA_VOLATILE') {
        console.log(`🔍 Buscando Top Voláteis na BD para ${strategy.name}...`);
        const topVolatile = await prisma.topVolatile.findMany({ orderBy: { rank: 'asc' } });
        if (topVolatile.length > 0) {
          symbolsToAnalyze = topVolatile.map((t) => t.symbol);
          console.log(`✅ Encontradas ${symbolsToAnalyze.length} Top Voláteis`);
        } else {
          console.warn(`⚠️ Nenhuma Top Volátil na BD. Execute "Atualizar Top Volatilidade" antes. Ignorando ${strategy.name}.`);
          continue;
        }
      }

      for (const symbol of symbolsToAnalyze) {
        for (const timeframe of timeframesToUse) {
          try {
            let signalResult: SignalResult | null = null;

            switch (strategy.name) {
              case 'VOLUME_SPIKE':
                signalResult = await runVolumeSpikeStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'VOLUME_SPIKE_15M':
                signalResult = await runVolumeSpike15mStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike 15m: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'RSI':
                signalResult = await runRsiStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ RSI: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'MA_VOLATILE':
                signalResult = await runMa60VolatileStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ MA Voláteis: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              default:
                if (!unknownStrategiesLogged.has(strategy.name)) {
                  unknownStrategiesLogged.add(strategy.name);
                  console.warn(`Estratégia ignorada: ${strategy.name}`);
                }
                continue;
            }

            if (signalResult) {
              const recentSignal = await prisma.signal.findFirst({
                where: {
                  symbol,
                  strategyId: strategy.id,
                  timeframe,
                  direction: signalResult.direction,
                  status: { in: ['NEW', 'IN_PROGRESS'] },
                  generatedAt: {
                    gte: new Date(Date.now() - 2 * 60 * 60 * 1000),
                  },
                },
              });

              if (!recentSignal) {
                await prisma.signal.create({
                  data: {
                    symbol,
                    direction: signalResult.direction,
                    timeframe,
                    strategyId: strategy.id,
                    strategyName: strategy.displayName,
                    entryPrice: signalResult.entryPrice,
                    stopLoss: signalResult.stopLoss,
                    target1: signalResult.target1,
                    target2: signalResult.target2,
                    target3: signalResult.target3,
                    strength: signalResult.strength,
                    status: 'NEW',
                    extraInfo: signalResult.extraInfo,
                  },
                });
                signalsCreated++;
                console.log(`✅ Sinal criado: ${symbol} ${signalResult.direction} (${strategy.displayName})`);
              } else {
                console.log(`⏭️ Sinal duplicado ignorado: ${symbol} ${signalResult.direction}`);
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Erro ${strategy.name} ${symbol} ${timeframe}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro ao executar estratégias:', error);
    throw error;
  }

  return signalsCreated;
}
