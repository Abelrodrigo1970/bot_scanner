'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Signal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  strategyName: string;
  entryPrice: number;
  price24h: number | null;
  result24h: number | null;
  status24h: string | null;
  high24h: number | null;
  low24h: number | null;
  strength: number;
  generatedAt: string;
}

interface SignalWithResult extends Signal {
  netResult: number;
}

interface AnalysisStats {
  // Trades de compra por percentual (usando Max24h)
  buyByMaxPercent: {
    '0-5%': number;
    '6%': number;
    '7%': number;
    '8%': number;
    '9%': number;
    '10-15%': number;
    '15-20%': number;
    '+20%': number;
  };
  
  // Trades de compra por percentual (usando resultado final)
  buyByResultPercent: {
    '0-5%': number;
    '6%': number;
    '7%': number;
    '8%': number;
    '9%': number;
    '10-15%': number;
    '15-20%': number;
    '+20%': number;
  };
  
  // Trades de venda por percentual (usando Min24h)
  sellByMaxPercent: {
    '0-5%': number;
    '6%': number;
    '7%': number;
    '8%': number;
    '9%': number;
    '10-15%': number;
    '15-20%': number;
    '+20%': number;
  };
  
  // Trades de venda por percentual (usando resultado final)
  sellByResultPercent: {
    '0-5%': number;
    '6%': number;
    '7%': number;
    '8%': number;
    '9%': number;
    '10-15%': number;
    '15-20%': number;
    '+20%': number;
  };
  
  // Trades que perderam por percentual (usando Min24h para LONG, Max24h para SHORT)
  lossByMaxPercent: {
    '0 a -5%': number;
    '-6%': number;
    '-7%': number;
    '-8%': number;
    '-9%': number;
    '-10 a -15%': number;
    '-15 a -20%': number;
    '-20% ou menos': number;
  };
  
  // Trades que perderam por percentual (usando resultado final)
  lossByResultPercent: {
    '0 a -5%': number;
    '-6%': number;
    '-7%': number;
    '-8%': number;
    '-9%': number;
    '-10 a -15%': number;
    '-15 a -20%': number;
    '-20% ou menos': number;
  };
  
  // Horários dos melhores trades
  bestTradesByHour: Record<number, {
    count: number;
    avgResult: number;
    totalResult: number;
  }>;
  
  // Horários dos piores trades
  worstTradesByHour: Record<number, {
    count: number;
    avgResult: number;
    totalResult: number;
  }>;
  
  // Top trades por percentual Max24h (compra)
  topTradesByMax: Array<{
    symbol: string;
    entryPrice: number;
    high24h: number;
    maxPercent: number;
    resultPercent: number;
    strength: number;
    hour: number;
    generatedAt: string;
  }>;
  
  // Top trades por percentual Max24h (venda)
  topSellTradesByMax: Array<{
    symbol: string;
    entryPrice: number;
    low24h: number;
    maxPercent: number;
    resultPercent: number;
    strength: number;
    hour: number;
    generatedAt: string;
  }>;
  
  // Piores trades por percentual
  worstTradesByMax: Array<{
    symbol: string;
    direction: string;
    entryPrice: number;
    extremePrice: number;
    maxPercent: number;
    resultPercent: number;
    hour: number;
    generatedAt: string;
  }>;
}

export default function AnalisePage() {
  const [signals, setSignals] = useState<SignalWithResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  useEffect(() => {
    fetchSignals();
  }, [dateFrom, dateTo]);

  const fetchSignals = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', '1000');
      params.append('minStrength', '70');
      params.append('onlyClosed', 'true');
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);

      const response = await fetch(`/api/signals?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        const FEE_OPEN = 0.0005;
        const FEE_CLOSE = 0.0005;
        const TOTAL_FEE = FEE_OPEN + FEE_CLOSE;

        const signalsWithResults: SignalWithResult[] = data.signals.map((s: Signal) => {
          if (s.result24h === null) return { ...s, netResult: 0 };
          const grossResult = (s.result24h / s.entryPrice) * 100;
          const feeAmount = 100 * TOTAL_FEE;
          const netResult = grossResult - feeAmount;
          return { ...s, netResult };
        });

        setSignals(signalsWithResults);
        calculateAnalysis(signalsWithResults);
      }
    } catch (error) {
      console.error('Erro ao buscar resultados:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateAnalysis = (signals: SignalWithResult[]) => {
    // Filtrar trades
    const buySignals = signals.filter((s) => s.direction === 'BUY' && s.high24h !== null);
    const sellSignals = signals.filter((s) => s.direction === 'SELL' && s.low24h !== null);
    const lossSignals = signals.filter((s) => s.netResult < 0 && ((s.direction === 'BUY' && s.low24h !== null) || (s.direction === 'SELL' && s.high24h !== null)));

    // Função para calcular percentual baseado em Max24h (para compra)
    const getBuyMaxPercent = (signal: SignalWithResult): number | null => {
      if (!signal.high24h) return null;
      return ((signal.high24h - signal.entryPrice) / signal.entryPrice) * 100;
    };

    // Função para calcular percentual baseado em Min24h (para venda)
    const getSellMaxPercent = (signal: SignalWithResult): number | null => {
      if (!signal.low24h) return null;
      return ((signal.entryPrice - signal.low24h) / signal.entryPrice) * 100;
    };

    // Função para calcular percentual de perda máximo
    const getLossMaxPercent = (signal: SignalWithResult): number | null => {
      if (signal.direction === 'BUY' && signal.low24h !== null) {
        return ((signal.low24h - signal.entryPrice) / signal.entryPrice) * 100; // Negativo
      } else if (signal.direction === 'SELL' && signal.high24h !== null) {
        return ((signal.entryPrice - signal.high24h) / signal.entryPrice) * 100; // Negativo
      }
      return null;
    };

    // Função para calcular percentual baseado no resultado final
    const getResultPercent = (signal: SignalWithResult): number => {
      return signal.netResult;
    };

    // Função para categorizar percentual positivo
    const categorizePositivePercent = (percent: number): keyof AnalysisStats['buyByMaxPercent'] => {
      if (percent >= 0 && percent < 5) return '0-5%';
      if (percent >= 5 && percent < 6) return '6%';
      if (percent >= 6 && percent < 7) return '7%';
      if (percent >= 7 && percent < 8) return '8%';
      if (percent >= 8 && percent < 9) return '9%';
      if (percent >= 9 && percent < 15) return '10-15%';
      if (percent >= 15 && percent < 20) return '15-20%';
      if (percent >= 20) return '+20%';
      return '0-5%';
    };

    // Função para categorizar percentual negativo
    const categorizeNegativePercent = (percent: number): keyof AnalysisStats['lossByMaxPercent'] => {
      if (percent >= -5 && percent < 0) return '0 a -5%';
      if (percent >= -6 && percent < -5) return '-6%';
      if (percent >= -7 && percent < -6) return '-7%';
      if (percent >= -8 && percent < -7) return '-8%';
      if (percent >= -9 && percent < -8) return '-9%';
      if (percent >= -15 && percent < -9) return '-10 a -15%';
      if (percent >= -20 && percent < -15) return '-15 a -20%';
      if (percent < -20) return '-20% ou menos';
      return '0 a -5%';
    };

    // Inicializar contadores para compra
    const buyByMaxPercent: AnalysisStats['buyByMaxPercent'] = {
      '0-5%': 0, '6%': 0, '7%': 0, '8%': 0, '9%': 0, '10-15%': 0, '15-20%': 0, '+20%': 0,
    };
    const buyByResultPercent: AnalysisStats['buyByResultPercent'] = {
      '0-5%': 0, '6%': 0, '7%': 0, '8%': 0, '9%': 0, '10-15%': 0, '15-20%': 0, '+20%': 0,
    };

    // Inicializar contadores para venda
    const sellByMaxPercent: AnalysisStats['sellByMaxPercent'] = {
      '0-5%': 0, '6%': 0, '7%': 0, '8%': 0, '9%': 0, '10-15%': 0, '15-20%': 0, '+20%': 0,
    };
    const sellByResultPercent: AnalysisStats['sellByResultPercent'] = {
      '0-5%': 0, '6%': 0, '7%': 0, '8%': 0, '9%': 0, '10-15%': 0, '15-20%': 0, '+20%': 0,
    };

    // Inicializar contadores para perdas
    const lossByMaxPercent: AnalysisStats['lossByMaxPercent'] = {
      '0 a -5%': 0, '-6%': 0, '-7%': 0, '-8%': 0, '-9%': 0, '-10 a -15%': 0, '-15 a -20%': 0, '-20% ou menos': 0,
    };
    const lossByResultPercent: AnalysisStats['lossByResultPercent'] = {
      '0 a -5%': 0, '-6%': 0, '-7%': 0, '-8%': 0, '-9%': 0, '-10 a -15%': 0, '-15 a -20%': 0, '-20% ou menos': 0,
    };

    // Processar trades de compra
    const buyTradesWithMaxPercent = buySignals.map((s) => {
      const maxPercent = getBuyMaxPercent(s);
      const resultPercent = getResultPercent(s);
      return { signal: s, maxPercent, resultPercent };
    });

    buyTradesWithMaxPercent.forEach(({ maxPercent, resultPercent }) => {
      if (maxPercent !== null && maxPercent >= 0) {
        const maxCategory = categorizePositivePercent(maxPercent);
        buyByMaxPercent[maxCategory]++;
      }
      if (resultPercent >= 0) {
        const resultCategory = categorizePositivePercent(resultPercent);
        buyByResultPercent[resultCategory]++;
      }
    });

    // Processar trades de venda
    const sellTradesWithMaxPercent = sellSignals.map((s) => {
      const maxPercent = getSellMaxPercent(s);
      const resultPercent = getResultPercent(s);
      return { signal: s, maxPercent, resultPercent };
    });

    sellTradesWithMaxPercent.forEach(({ maxPercent, resultPercent }) => {
      if (maxPercent !== null && maxPercent >= 0) {
        const maxCategory = categorizePositivePercent(maxPercent);
        sellByMaxPercent[maxCategory]++;
      }
      if (resultPercent >= 0) {
        const resultCategory = categorizePositivePercent(resultPercent);
        sellByResultPercent[resultCategory]++;
      }
    });

    // Processar trades que perderam
    const lossTradesWithMaxPercent = lossSignals.map((s) => {
      const maxPercent = getLossMaxPercent(s);
      const resultPercent = getResultPercent(s);
      return { signal: s, maxPercent, resultPercent };
    });

    lossTradesWithMaxPercent.forEach(({ maxPercent, resultPercent }) => {
      if (maxPercent !== null && maxPercent < 0) {
        const maxCategory = categorizeNegativePercent(maxPercent);
        lossByMaxPercent[maxCategory]++;
      }
      if (resultPercent < 0) {
        const resultCategory = categorizeNegativePercent(resultPercent);
        lossByResultPercent[resultCategory]++;
      }
    });

    // Horários dos melhores trades
    const bestTradesByHour: Record<number, { count: number; avgResult: number; totalResult: number }> = {};
    const allProfitableTrades = signals.filter((s) => s.netResult > 0);
    const sortedByResult = [...allProfitableTrades].sort((a, b) => b.netResult - a.netResult);
    const top50Trades = sortedByResult.slice(0, 50);

    top50Trades.forEach((trade) => {
      const date = new Date(trade.generatedAt);
      const hour = date.getHours();
      if (!bestTradesByHour[hour]) {
        bestTradesByHour[hour] = { count: 0, avgResult: 0, totalResult: 0 };
      }
      bestTradesByHour[hour].count++;
      bestTradesByHour[hour].totalResult += trade.netResult;
      bestTradesByHour[hour].avgResult = bestTradesByHour[hour].totalResult / bestTradesByHour[hour].count;
    });

    // Horários dos piores trades
    const worstTradesByHour: Record<number, { count: number; avgResult: number; totalResult: number }> = {};
    const sortedByLoss = [...lossSignals].sort((a, b) => a.netResult - b.netResult);
    const bottom50Trades = sortedByLoss.slice(0, 50);

    bottom50Trades.forEach((trade) => {
      const date = new Date(trade.generatedAt);
      const hour = date.getHours();
      if (!worstTradesByHour[hour]) {
        worstTradesByHour[hour] = { count: 0, avgResult: 0, totalResult: 0 };
      }
      worstTradesByHour[hour].count++;
      worstTradesByHour[hour].totalResult += trade.netResult;
      worstTradesByHour[hour].avgResult = worstTradesByHour[hour].totalResult / worstTradesByHour[hour].count;
    });

    // Top trades de compra por percentual Max24h
    const topTradesByMax = buyTradesWithMaxPercent
      .filter((t) => t.maxPercent !== null && t.maxPercent >= 0)
      .sort((a, b) => (b.maxPercent || 0) - (a.maxPercent || 0))
      .slice(0, 20)
      .map(({ signal, maxPercent, resultPercent }) => {
        const date = new Date(signal.generatedAt);
        return {
          symbol: signal.symbol,
          entryPrice: signal.entryPrice,
          high24h: signal.high24h!,
          maxPercent: maxPercent!,
          resultPercent,
          strength: signal.strength,
          hour: date.getHours(),
          generatedAt: signal.generatedAt,
        };
      });

    // Top trades de venda por percentual Max24h
    const topSellTradesByMax = sellTradesWithMaxPercent
      .filter((t) => t.maxPercent !== null && t.maxPercent >= 0)
      .sort((a, b) => (b.maxPercent || 0) - (a.maxPercent || 0))
      .slice(0, 20)
      .map(({ signal, maxPercent, resultPercent }) => {
        const date = new Date(signal.generatedAt);
        return {
          symbol: signal.symbol,
          entryPrice: signal.entryPrice,
          low24h: signal.low24h!,
          maxPercent: maxPercent!,
          resultPercent,
          strength: signal.strength,
          hour: date.getHours(),
          generatedAt: signal.generatedAt,
        };
      });

    // Piores trades por percentual
    const worstTradesByMax = lossTradesWithMaxPercent
      .filter((t) => t.maxPercent !== null && t.maxPercent < 0)
      .sort((a, b) => (a.maxPercent || 0) - (b.maxPercent || 0))
      .slice(0, 20)
      .map(({ signal, maxPercent, resultPercent }) => {
        const date = new Date(signal.generatedAt);
        const extremePrice = signal.direction === 'BUY' ? signal.low24h! : signal.high24h!;
        return {
          symbol: signal.symbol,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          extremePrice,
          maxPercent: maxPercent!,
          resultPercent,
          hour: date.getHours(),
          generatedAt: signal.generatedAt,
        };
      });

    setStats({
      buyByMaxPercent,
      buyByResultPercent,
      sellByMaxPercent,
      sellByResultPercent,
      lossByMaxPercent,
      lossByResultPercent,
      bestTradesByHour,
      worstTradesByHour,
      topTradesByMax,
      topSellTradesByMax,
      worstTradesByMax,
    });
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatPriceWithDecimals = (price: number, decimals: number = 4) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(price);
  };

  const formatPercent = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando análise...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Nenhum dado disponível para análise.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          Análise Completa de Trades
        </h1>

        {/* Filtro de datas para estatísticas */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filtro de período</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data inicial</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data final</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-md"
            >
              Limpar datas
            </button>
          </div>
        </div>

        {/* Trades de Compra por Percentual - Max24h */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Trades de Compra (BUY) - Número por Percentual (usando Máx 24h)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {Object.entries(stats.buyByMaxPercent).map(([range, count]) => (
              <div key={range} className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{range}</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trades de Compra por Percentual - Resultado Final */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Trades de Compra (BUY) - Número por Percentual (usando Resultado Final)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {Object.entries(stats.buyByResultPercent).map(([range, count]) => (
              <div key={range} className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{range}</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Horários dos Melhores Trades */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Horários dos Melhores Trades (Top 50)
          </h2>
          <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-3">
            {Array.from({ length: 24 }, (_, hour) => {
              const hourData = stats.bestTradesByHour[hour];
              return (
                <div
                  key={hour}
                  className={`rounded-lg p-3 text-center ${
                    hourData
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                      : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'
                  }`}
                >
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{hour}h</p>
                  {hourData ? (
                    <>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400">{hourData.count}</p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        ${formatPrice(hourData.avgResult)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">0</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Trades de Venda por Percentual - Min24h */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Trades de Venda (SELL) - Número por Percentual (usando Mín 24h)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {Object.entries(stats.sellByMaxPercent).map(([range, count]) => (
              <div key={range} className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{range}</p>
                <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trades de Venda por Percentual - Resultado Final */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Trades de Venda (SELL) - Número por Percentual (usando Resultado Final)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {Object.entries(stats.sellByResultPercent).map(([range, count]) => (
              <div key={range} className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{range}</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trades que Perderam por Percentual - Max/Min24h */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Trades que Perderam - Número por Percentual (usando Mín/Máx 24h)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {Object.entries(stats.lossByMaxPercent).map(([range, count]) => (
              <div key={range} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{range}</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trades que Perderam por Percentual - Resultado Final */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Trades que Perderam - Número por Percentual (usando Resultado Final)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {Object.entries(stats.lossByResultPercent).map(([range, count]) => (
              <div key={range} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{range}</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Horários dos Piores Trades */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Horários dos Piores Trades (Bottom 50)
          </h2>
          <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-3">
            {Array.from({ length: 24 }, (_, hour) => {
              const hourData = stats.worstTradesByHour[hour];
              return (
                <div
                  key={hour}
                  className={`rounded-lg p-3 text-center ${
                    hourData
                      ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                      : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'
                  }`}
                >
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{hour}h</p>
                  {hourData ? (
                    <>
                      <p className="text-lg font-bold text-red-600 dark:text-red-400">{hourData.count}</p>
                      <p className="text-xs text-red-600 dark:text-red-400">
                        ${formatPrice(hourData.avgResult)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">0</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Trades de Compra por Max24h */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Top 20 Trades de Compra por Máx 24h
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Par</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Entrada</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Máx 24h</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">% Máx</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">% Resultado</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Força</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Hora</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Data/Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {stats.topTradesByMax.map((trade, index) => {
                  const date = new Date(trade.generatedAt);
                  const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                  
                  return (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-3 py-2 text-sm font-bold text-gray-900 dark:text-white">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.symbol}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        ${formatPriceWithDecimals(trade.entryPrice, 4)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        ${formatPriceWithDecimals(trade.high24h, 4)}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <div className="font-bold text-blue-600 dark:text-blue-400">
                          +{formatPercent(trade.maxPercent)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <div className={`font-bold ${trade.resultPercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {trade.resultPercent >= 0 ? '+' : ''}{formatPercent(trade.resultPercent)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.strength}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.hour}h
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {formattedDate}
                      </td>
                    </tr>
                  );
                })}
                {stats.topTradesByMax.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                      Nenhum trade encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Trades de Venda por Min24h */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Top 20 Trades de Venda por Mín 24h
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Par</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Entrada</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Mín 24h</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">% Máx</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">% Resultado</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Força</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Hora</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Data/Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {stats.topSellTradesByMax.map((trade, index) => {
                  const date = new Date(trade.generatedAt);
                  const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                  
                  return (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-3 py-2 text-sm font-bold text-gray-900 dark:text-white">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.symbol}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        ${formatPriceWithDecimals(trade.entryPrice, 4)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        ${formatPriceWithDecimals(trade.low24h, 4)}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <div className="font-bold text-purple-600 dark:text-purple-400">
                          +{formatPercent(trade.maxPercent)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <div className={`font-bold ${trade.resultPercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {trade.resultPercent >= 0 ? '+' : ''}{formatPercent(trade.resultPercent)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.strength}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.hour}h
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {formattedDate}
                      </td>
                    </tr>
                  );
                })}
                {stats.topSellTradesByMax.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                      Nenhum trade encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Piores Trades por Percentual */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Piores 20 Trades por Percentual
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Par</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Dir</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Entrada</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Extremo 24h</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">% Máx</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">% Resultado</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Hora</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Data/Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {stats.worstTradesByMax.map((trade, index) => {
                  const date = new Date(trade.generatedAt);
                  const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                  
                  return (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-3 py-2 text-sm font-bold text-gray-900 dark:text-white">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.symbol}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          trade.direction === 'BUY' 
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}>
                          {trade.direction}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        ${formatPriceWithDecimals(trade.entryPrice, 4)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        ${formatPriceWithDecimals(trade.extremePrice, 4)}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <div className="font-bold text-red-600 dark:text-red-400">
                          {formatPercent(trade.maxPercent)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <div className="font-bold text-red-600 dark:text-red-400">
                          {formatPercent(trade.resultPercent)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {trade.hour}h
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {formattedDate}
                      </td>
                    </tr>
                  );
                })}
                {stats.worstTradesByMax.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                      Nenhum trade encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Disclaimer />
      </main>
    </div>
  );
}

