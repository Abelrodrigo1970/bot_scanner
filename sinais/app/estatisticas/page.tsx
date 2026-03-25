'use client';

import { useEffect, useMemo, useState } from 'react';
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

interface Statistics {
  // Gerais
  total: number;
  lucros: number;
  prejuizos: number;
  totalLucro: number;
  totalPrejuizo: number;
  lucroLiquido: number;
  winRate: number;
  avgLucro: number;
  avgPrejuizo: number;
  profitFactor: number;
  maxDrawdown: number;
  maxGain: number;
  
  // Por direção
  buyStats: {
    total: number;
    lucros: number;
    prejuizos: number;
    winRate: number;
    totalLucro: number;
    totalPrejuizo: number;
    lucroLiquido: number;
    avgLucro: number;
    avgPrejuizo: number;
  };
  sellStats: {
    total: number;
    lucros: number;
    prejuizos: number;
    winRate: number;
    totalLucro: number;
    totalPrejuizo: number;
    lucroLiquido: number;
    avgLucro: number;
    avgPrejuizo: number;
  };
  
  // Por estratégia
  byStrategy: Record<string, {
    total: number;
    lucros: number;
    prejuizos: number;
    winRate: number;
    totalLucro: number;
    totalPrejuizo: number;
    lucroLiquido: number;
    avgLucro: number;
    avgPrejuizo: number;
    profitFactor: number;
  }>;
  
  // Por timeframe
  byTimeframe: Record<string, {
    total: number;
    lucros: number;
    prejuizos: number;
    winRate: number;
    totalLucro: number;
    totalPrejuizo: number;
    lucroLiquido: number;
  }>;
  
  // Por força
  byStrength: {
    '40-60': { total: number; lucros: number; prejuizos: number; winRate: number; totalLucro: number; lucroLiquido: number };
    '61-80': { total: number; lucros: number; prejuizos: number; winRate: number; totalLucro: number; lucroLiquido: number };
    '81-100': { total: number; lucros: number; prejuizos: number; winRate: number; totalLucro: number; lucroLiquido: number };
  };
  
  // Distribuição de resultados
  resultDistribution: {
    '0-5%': number;
    '5-10%': number;
    '10-20%': number;
    '20%+': number;
    '0 a -5%': number;
    '-5 a -10%': number;
    '-10% ou menos': number;
  };
  
  // Sequências
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: { type: 'win' | 'loss'; count: number };
}

export default function EstatisticasPage() {
  const [signals, setSignals] = useState<SignalWithResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Statistics | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  
  // Estados para simulação
  const [useSimulation, setUseSimulation] = useState(false);
  // BUY (compra): defaults pedidos
  const [buyStopLoss, setBuyStopLoss] = useState<string>('11');
  const [buyTakeProfit1, setBuyTakeProfit1] = useState<string>('15');
  const [buyTakeProfit2, setBuyTakeProfit2] = useState<string>('24');
  // SELL (venda): manter defaults atuais
  const [sellStopLoss, setSellStopLoss] = useState<string>('4');
  const [sellTakeProfit1, setSellTakeProfit1] = useState<string>('9');
  const [sellTakeProfit2, setSellTakeProfit2] = useState<string>('24');
  const [buyTp1PositionPercent, setBuyTp1PositionPercent] = useState<string>('35');
  const [buyTp2PositionPercent, setBuyTp2PositionPercent] = useState<string>('35');
  const [sellTp1PositionPercent, setSellTp1PositionPercent] = useState<string>('35');
  const [sellTp2PositionPercent, setSellTp2PositionPercent] = useState<string>('35');
  const [finalCloseHours, setFinalCloseHours] = useState<string>('24');
  const [simulatedStats, setSimulatedStats] = useState<Statistics | null>(null);

  const strategyOptions = useMemo(() => {
    const unique = new Set(signals.map((s) => s.strategyName).filter(Boolean));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [signals]);

  const filteredSignals = useMemo(() => {
    if (!selectedStrategy) return signals;
    return signals.filter((s) => s.strategyName === selectedStrategy);
  }, [signals, selectedStrategy]);

  useEffect(() => {
    fetchSignals();
  }, []);

  const fetchSignals = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', '2000');
      params.append('minStrength', '70');
      params.append('onlyClosed', 'true');

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
        const calculatedStats = calculateStatistics(
          selectedStrategy
            ? signalsWithResults.filter((s) => s.strategyName === selectedStrategy)
            : signalsWithResults
        );
        setStats(calculatedStats);
      }
    } catch (error) {
      console.error('Erro ao buscar resultados:', error);
    } finally {
      setLoading(false);
    }
  };

  // Simulação com 2 TPs + fechamento final por tempo (24h por padrão).
  // Para horas > 24, usa projeção linear a partir do resultado de 24h.
  const simulateTrade = (
    signal: SignalWithResult,
    buyParams: { stopLossPercent: number; tp1Percent: number; tp2Percent: number },
    sellParams: { stopLossPercent: number; tp1Percent: number; tp2Percent: number },
    buyPositionParams: { tp1PosPercent: number; tp2PosPercent: number },
    sellPositionParams: { tp1PosPercent: number; tp2PosPercent: number },
    finalHours: number
  ): number => {
    const FEE_OPEN = 0.0005;
    const FEE_CLOSE = 0.0005;
    const TOTAL_FEE = FEE_OPEN + FEE_CLOSE;
    const feeAmount = 100 * TOTAL_FEE;

    // Calcular preços de stop loss e take profits
    let stopLossPrice: number;
    let takeProfit1Price: number;
    let takeProfit2Price: number;

    const activeParams = signal.direction === 'BUY' ? buyParams : sellParams;
    const activePositionParams = signal.direction === 'BUY' ? buyPositionParams : sellPositionParams;
    const stopLossPercent = activeParams.stopLossPercent;
    const tp1Percent = activeParams.tp1Percent;
    const tp2Percent = activeParams.tp2Percent;
    const tp1Weight = Math.max(0, Math.min(100, activePositionParams.tp1PosPercent)) / 100;
    const tp2Weight = Math.max(0, Math.min(100, activePositionParams.tp2PosPercent)) / 100;
    const finalWeight = Math.max(0, 1 - tp1Weight - tp2Weight);

    if (signal.direction === 'BUY') {
      stopLossPrice = signal.entryPrice * (1 - stopLossPercent / 100);
      takeProfit1Price = signal.entryPrice * (1 + tp1Percent / 100);
      takeProfit2Price = signal.entryPrice * (1 + tp2Percent / 100);
    } else {
      // Para SELL, stop loss é acima e take profits são abaixo
      stopLossPrice = signal.entryPrice * (1 + stopLossPercent / 100);
      takeProfit1Price = signal.entryPrice * (1 - tp1Percent / 100);
      takeProfit2Price = signal.entryPrice * (1 - tp2Percent / 100);
    }

    // Resultado base em 24h, depois projetado para N horas (simulação)
    const base24hPercent =
      signal.result24h === null ? 0 : (signal.result24h / signal.entryPrice) * 100;
    const hoursMultiplier = Math.max(0.25, finalHours / 24);
    const finalResultPercent = base24hPercent * hoursMultiplier;

    let grossPercentResult = 0;

    // Regra conservadora: se SL aparece nas extremas, considera SL primeiro (como na lógica anterior).
    if (signal.direction === 'BUY') {
      if (signal.low24h !== null && signal.low24h <= stopLossPrice) {
        grossPercentResult = -stopLossPercent;
      } else if (signal.high24h !== null && signal.high24h >= takeProfit2Price) {
        // TP2 atingido -> assume TP1 + TP2 + restante no fechamento final
        grossPercentResult =
          tp1Weight * tp1Percent +
          tp2Weight * tp2Percent +
          finalWeight * finalResultPercent;
      } else if (signal.high24h !== null && signal.high24h >= takeProfit1Price) {
        // Apenas TP1 atingido -> restante no fechamento final
        const remainingWeight = Math.max(0, 1 - tp1Weight);
        grossPercentResult = tp1Weight * tp1Percent + remainingWeight * finalResultPercent;
      } else {
        // Nenhum TP/SL -> fechamento final
        grossPercentResult = finalResultPercent;
      }
    } else {
      if (signal.high24h !== null && signal.high24h >= stopLossPrice) {
        grossPercentResult = -stopLossPercent;
      } else if (signal.low24h !== null && signal.low24h <= takeProfit2Price) {
        grossPercentResult =
          tp1Weight * tp1Percent +
          tp2Weight * tp2Percent +
          finalWeight * finalResultPercent;
      } else if (signal.low24h !== null && signal.low24h <= takeProfit1Price) {
        const remainingWeight = Math.max(0, 1 - tp1Weight);
        grossPercentResult = tp1Weight * tp1Percent + remainingWeight * finalResultPercent;
      } else {
        grossPercentResult = finalResultPercent;
      }
    }

    // netResult em $ para posição de $100 => valor numérico equivale ao %
    return grossPercentResult - feeAmount;
  };

  // Função para calcular estatísticas simuladas
  const calculateSimulatedStatistics = (sourceSignals?: SignalWithResult[]) => {
    const buyStopLossNum = parseFloat(buyStopLoss) || 11;
    const buyTakeProfit1Num = parseFloat(buyTakeProfit1) || 15;
    const buyTakeProfit2Num = parseFloat(buyTakeProfit2) || 24;
    const sellStopLossNum = parseFloat(sellStopLoss) || 4;
    const sellTakeProfit1Num = parseFloat(sellTakeProfit1) || 9;
    const sellTakeProfit2Num = parseFloat(sellTakeProfit2) || 24;
    const buyTp1PositionNum = parseFloat(buyTp1PositionPercent) || 35;
    const buyTp2PositionNum = parseFloat(buyTp2PositionPercent) || 35;
    const sellTp1PositionNum = parseFloat(sellTp1PositionPercent) || 35;
    const sellTp2PositionNum = parseFloat(sellTp2PositionPercent) || 35;
    const finalHoursNum = parseFloat(finalCloseHours) || 24;

    // Simular cada trade
    const baseSignals = sourceSignals ?? filteredSignals;
    const simulatedSignals: SignalWithResult[] = baseSignals.map((s) => ({
      ...s,
      netResult: simulateTrade(
        s,
        {
          stopLossPercent: buyStopLossNum,
          tp1Percent: buyTakeProfit1Num,
          tp2Percent: buyTakeProfit2Num,
        },
        {
          stopLossPercent: sellStopLossNum,
          tp1Percent: sellTakeProfit1Num,
          tp2Percent: sellTakeProfit2Num,
        },
        {
          tp1PosPercent: buyTp1PositionNum,
          tp2PosPercent: buyTp2PositionNum,
        },
        {
          tp1PosPercent: sellTp1PositionNum,
          tp2PosPercent: sellTp2PositionNum,
        },
        finalHoursNum
      ),
    }));

    // Recalcular estatísticas com trades simulados
    const calculatedStats = calculateStatistics(simulatedSignals);
    setSimulatedStats(calculatedStats);
  };

  useEffect(() => {
    const calculatedStats = calculateStatistics(filteredSignals);
    setStats(calculatedStats);
    if (useSimulation) {
      calculateSimulatedStatistics(filteredSignals);
    }
  }, [filteredSignals, useSimulation]);

  const calculateStatistics = (signalsToCalculate: SignalWithResult[]): Statistics => {
    const total = signalsToCalculate.length;
    const lucros = signalsToCalculate.filter((s) => s.netResult >= 0);
    const prejuizos = signalsToCalculate.filter((s) => s.netResult < 0);
    
    const totalLucro = lucros.reduce((sum, s) => sum + s.netResult, 0);
    const totalPrejuizo = Math.abs(prejuizos.reduce((sum, s) => sum + s.netResult, 0));
    const lucroLiquido = totalLucro - totalPrejuizo;
    const winRate = total > 0 ? (lucros.length / total) * 100 : 0;
    const avgLucro = lucros.length > 0 ? totalLucro / lucros.length : 0;
    const avgPrejuizo = prejuizos.length > 0 ? totalPrejuizo / prejuizos.length : 0;
    const profitFactor = totalPrejuizo > 0 ? totalLucro / totalPrejuizo : totalLucro > 0 ? Infinity : 0;
    
    const maxGain = signalsToCalculate.length > 0 ? Math.max(...signalsToCalculate.map(s => s.netResult)) : 0;
    const maxDrawdown = signalsToCalculate.length > 0 ? Math.min(...signalsToCalculate.map(s => s.netResult)) : 0;

    // Por direção
    const buySignals = signalsToCalculate.filter((s) => s.direction === 'BUY');
    const sellSignals = signalsToCalculate.filter((s) => s.direction === 'SELL');
    
    const buyLucros = buySignals.filter((s) => s.netResult >= 0);
    const buyPrejuizos = buySignals.filter((s) => s.netResult < 0);
    const sellLucros = sellSignals.filter((s) => s.netResult >= 0);
    const sellPrejuizos = sellSignals.filter((s) => s.netResult < 0);
    
    const buyStats = {
      total: buySignals.length,
      lucros: buyLucros.length,
      prejuizos: buyPrejuizos.length,
      winRate: buySignals.length > 0 ? (buyLucros.length / buySignals.length) * 100 : 0,
      totalLucro: buyLucros.reduce((sum, s) => sum + s.netResult, 0),
      totalPrejuizo: Math.abs(buyPrejuizos.reduce((sum, s) => sum + s.netResult, 0)),
      lucroLiquido: buyLucros.reduce((sum, s) => sum + s.netResult, 0) - Math.abs(buyPrejuizos.reduce((sum, s) => sum + s.netResult, 0)),
      avgLucro: buyLucros.length > 0 ? buyLucros.reduce((sum, s) => sum + s.netResult, 0) / buyLucros.length : 0,
      avgPrejuizo: buyPrejuizos.length > 0 ? Math.abs(buyPrejuizos.reduce((sum, s) => sum + s.netResult, 0)) / buyPrejuizos.length : 0,
    };
    
    const sellStats = {
      total: sellSignals.length,
      lucros: sellLucros.length,
      prejuizos: sellPrejuizos.length,
      winRate: sellSignals.length > 0 ? (sellLucros.length / sellSignals.length) * 100 : 0,
      totalLucro: sellLucros.reduce((sum, s) => sum + s.netResult, 0),
      totalPrejuizo: Math.abs(sellPrejuizos.reduce((sum, s) => sum + s.netResult, 0)),
      lucroLiquido: sellLucros.reduce((sum, s) => sum + s.netResult, 0) - Math.abs(sellPrejuizos.reduce((sum, s) => sum + s.netResult, 0)),
      avgLucro: sellLucros.length > 0 ? sellLucros.reduce((sum, s) => sum + s.netResult, 0) / sellLucros.length : 0,
      avgPrejuizo: sellPrejuizos.length > 0 ? Math.abs(sellPrejuizos.reduce((sum, s) => sum + s.netResult, 0)) / sellPrejuizos.length : 0,
    };

    // Por estratégia
    const byStrategy: Record<string, SignalWithResult[]> = {};
    signalsToCalculate.forEach((s) => {
      if (!byStrategy[s.strategyName]) {
        byStrategy[s.strategyName] = [];
      }
      byStrategy[s.strategyName].push(s);
    });

    const strategyStats: Record<string, any> = {};
    Object.keys(byStrategy).forEach((strategy) => {
      const strategySignals = byStrategy[strategy];
      const strategyLucros = strategySignals.filter((s) => s.netResult >= 0);
      const strategyPrejuizos = strategySignals.filter((s) => s.netResult < 0);
      const strategyTotalLucro = strategyLucros.reduce((sum, s) => sum + s.netResult, 0);
      const strategyTotalPrejuizo = Math.abs(strategyPrejuizos.reduce((sum, s) => sum + s.netResult, 0));
      const strategyProfitFactor = strategyTotalPrejuizo > 0 ? strategyTotalLucro / strategyTotalPrejuizo : strategyTotalLucro > 0 ? Infinity : 0;
      
      strategyStats[strategy] = {
        total: strategySignals.length,
        lucros: strategyLucros.length,
        prejuizos: strategyPrejuizos.length,
        winRate: strategySignals.length > 0 ? (strategyLucros.length / strategySignals.length) * 100 : 0,
        totalLucro: strategyTotalLucro,
        totalPrejuizo: strategyTotalPrejuizo,
        lucroLiquido: strategyTotalLucro - strategyTotalPrejuizo,
        avgLucro: strategyLucros.length > 0 ? strategyTotalLucro / strategyLucros.length : 0,
        avgPrejuizo: strategyPrejuizos.length > 0 ? strategyTotalPrejuizo / strategyPrejuizos.length : 0,
        profitFactor: strategyProfitFactor,
      };
    });

    // Por timeframe
    const byTimeframe: Record<string, SignalWithResult[]> = {};
    signalsToCalculate.forEach((s) => {
      if (!byTimeframe[s.timeframe]) {
        byTimeframe[s.timeframe] = [];
      }
      byTimeframe[s.timeframe].push(s);
    });

    const timeframeStats: Record<string, any> = {};
    Object.keys(byTimeframe).forEach((tf) => {
      const tfSignals = byTimeframe[tf];
      const tfLucros = tfSignals.filter((s) => s.netResult >= 0);
      const tfPrejuizos = tfSignals.filter((s) => s.netResult < 0);
      const tfTotalLucro = tfLucros.reduce((sum, s) => sum + s.netResult, 0);
      const tfTotalPrejuizo = Math.abs(tfPrejuizos.reduce((sum, s) => sum + s.netResult, 0));
      
      timeframeStats[tf] = {
        total: tfSignals.length,
        lucros: tfLucros.length,
        prejuizos: tfPrejuizos.length,
        winRate: tfSignals.length > 0 ? (tfLucros.length / tfSignals.length) * 100 : 0,
        totalLucro: tfTotalLucro,
        totalPrejuizo: tfTotalPrejuizo,
        lucroLiquido: tfTotalLucro - tfTotalPrejuizo,
      };
    });

    // Por força
    const strength40_60 = signalsToCalculate.filter((s) => s.strength >= 40 && s.strength <= 60);
    const strength61_80 = signalsToCalculate.filter((s) => s.strength >= 61 && s.strength <= 80);
    const strength81_100 = signalsToCalculate.filter((s) => s.strength >= 81 && s.strength <= 100);

    const calcStrengthStats = (strengthSignals: SignalWithResult[]) => {
      const lucros = strengthSignals.filter((s) => s.netResult >= 0);
      const prejuizos = strengthSignals.filter((s) => s.netResult < 0);
      const totalLucro = lucros.reduce((sum, s) => sum + s.netResult, 0);
      const totalPrejuizo = Math.abs(prejuizos.reduce((sum, s) => sum + s.netResult, 0));
      return {
        total: strengthSignals.length,
        lucros: lucros.length,
        prejuizos: prejuizos.length,
        winRate: strengthSignals.length > 0 ? (lucros.length / strengthSignals.length) * 100 : 0,
        totalLucro,
        lucroLiquido: totalLucro - totalPrejuizo,
      };
    };

    // Distribuição de resultados
    const resultDistribution = {
      '0-5%': signalsToCalculate.filter(s => s.netResult >= 0 && s.netResult < 5).length,
      '5-10%': signalsToCalculate.filter(s => s.netResult >= 5 && s.netResult < 10).length,
      '10-20%': signalsToCalculate.filter(s => s.netResult >= 10 && s.netResult < 20).length,
      '20%+': signalsToCalculate.filter(s => s.netResult >= 20).length,
      '0 a -5%': signalsToCalculate.filter(s => s.netResult < 0 && s.netResult >= -5).length,
      '-5 a -10%': signalsToCalculate.filter(s => s.netResult < -5 && s.netResult >= -10).length,
      '-10% ou menos': signalsToCalculate.filter(s => s.netResult < -10).length,
    };

    // Sequências (win/loss streaks)
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentStreak = { type: 'win' as 'win' | 'loss', count: 0 };
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    // Ordenar por data (mais antigo primeiro)
    const sortedSignals = [...signalsToCalculate].sort((a, b) => 
      new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime()
    );

    sortedSignals.forEach((s) => {
      if (s.netResult >= 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxWinStreak) {
          maxWinStreak = currentWinStreak;
        }
      } else {
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxLossStreak) {
          maxLossStreak = currentLossStreak;
        }
      }
    });

    // Calcular streak atual (do mais recente)
    const reversedSignals = [...signalsToCalculate].sort((a, b) => 
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
    
    if (reversedSignals.length > 0) {
      const firstResult = reversedSignals[0].netResult >= 0 ? 'win' : 'loss';
      let count = 1;
      for (let i = 1; i < reversedSignals.length; i++) {
        const isWin = reversedSignals[i].netResult >= 0;
        if ((firstResult === 'win' && isWin) || (firstResult === 'loss' && !isWin)) {
          count++;
        } else {
          break;
        }
      }
      currentStreak = { type: firstResult, count };
    }

    const calculatedStats: Statistics = {
      total,
      lucros: lucros.length,
      prejuizos: prejuizos.length,
      totalLucro,
      totalPrejuizo,
      lucroLiquido,
      winRate,
      avgLucro,
      avgPrejuizo,
      profitFactor,
      maxDrawdown,
      maxGain,
      buyStats,
      sellStats,
      byStrategy: strategyStats,
      byTimeframe: timeframeStats,
      byStrength: {
        '40-60': calcStrengthStats(strength40_60),
        '61-80': calcStrengthStats(strength61_80),
        '81-100': calcStrengthStats(strength81_100),
      },
      resultDistribution,
      maxWinStreak,
      maxLossStreak,
      currentStreak,
    };

    return calculatedStats;
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
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
            <p className="text-gray-600 dark:text-gray-400">Carregando estatísticas...</p>
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
            <p className="text-gray-600 dark:text-gray-400">Nenhum dado disponível para estatísticas.</p>
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
          Estatísticas dos Resultados
        </h1>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filtro</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Estratégia
              </label>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Todas</option>
                {strategyOptions.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Painel de Simulação */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Simulação com Stop Loss, 2 TPs e Fechamento Final
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-4">
            <div className="md:col-span-4 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Compra (BUY)
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                SL BUY (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={buyStopLoss}
                onChange={(e) => setBuyStopLoss(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="11"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                TP1 BUY (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={buyTakeProfit1}
                onChange={(e) => setBuyTakeProfit1(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="15"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                TP2 BUY (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={buyTakeProfit2}
                onChange={(e) => setBuyTakeProfit2(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="24"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Fechamento Final (h)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="240"
                value={finalCloseHours}
                onChange={(e) => setFinalCloseHours(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="24"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-4">
            <div className="md:col-span-4 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Venda (SELL)
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                SL SELL (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={sellStopLoss}
                onChange={(e) => setSellStopLoss(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="4"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                TP1 SELL (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={sellTakeProfit1}
                onChange={(e) => setSellTakeProfit1(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="9"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                TP2 SELL (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={sellTakeProfit2}
                onChange={(e) => setSellTakeProfit2(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="24"
              />
            </div>
            <div className="flex items-center">
              <label className="flex items-center cursor-pointer mt-6">
                <input
                  type="checkbox"
                  checked={useSimulation}
                  onChange={(e) => {
                    setUseSimulation(e.target.checked);
                    if (e.target.checked) {
                      calculateSimulatedStatistics(filteredSignals);
                    } else {
                      setSimulatedStats(null);
                    }
                  }}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Usar Simulação
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                % Posição TP1 BUY
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={buyTp1PositionPercent}
                onChange={(e) => setBuyTp1PositionPercent(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="35"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                % Posição TP2 BUY
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={buyTp2PositionPercent}
                onChange={(e) => setBuyTp2PositionPercent(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="35"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                % Posição TP1 SELL
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={sellTp1PositionPercent}
                onChange={(e) => setSellTp1PositionPercent(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="35"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                % Posição TP2 SELL
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={sellTp2PositionPercent}
                onChange={(e) => setSellTp2PositionPercent(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="35"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mt-4">
            <div>
              <button
                onClick={() => calculateSimulatedStatistics(filteredSignals)}
                disabled={!useSimulation}
                className={`w-full px-4 py-2 rounded-md font-medium transition-colors ${
                  useSimulation
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                Recalcular
              </button>
            </div>
          </div>
          {useSimulation && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                <strong>Simulação ativa:</strong> BUY [SL {buyStopLoss}% | TP1 {buyTakeProfit1}% ({buyTp1PositionPercent}%) | TP2 {buyTakeProfit2}% ({buyTp2PositionPercent}%)] | SELL [SL {sellStopLoss}% | TP1 {sellTakeProfit1}% ({sellTp1PositionPercent}%) | TP2 {sellTakeProfit2}% ({sellTp2PositionPercent}%)] | Fechamento final em {finalCloseHours}h
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                As estatísticas abaixo usam 2 take profits + fechamento final do restante. Para horas acima de 24h, o resultado final usa projeção linear baseada no resultado de 24h (simulação).
              </p>
            </div>
          )}
        </div>

        {/* Usar simulatedStats se simulação estiver ativa, senão usar stats */}
        {(() => {
          const displayStats = useSimulation && simulatedStats ? simulatedStats : stats;
          if (!displayStats) return null;

          return (
            <>
                    {/* Estatísticas Gerais */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total de Trades</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{displayStats.total}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Win Rate: {formatPercent(displayStats.winRate)}%
                  </p>
                </div>
                
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl shadow p-6 border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-600 dark:text-green-400 mb-1">Lucro Líquido</p>
                  <p className={`text-3xl font-bold ${displayStats.lucroLiquido >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {displayStats.lucroLiquido >= 0 ? '+' : ''}${formatPrice(displayStats.lucroLiquido)}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                    {displayStats.lucros} lucros | {displayStats.prejuizos} prejuízos
                  </p>
                </div>
                
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl shadow p-6 border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-600 dark:text-blue-400 mb-1">Profit Factor</p>
                  <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                    {displayStats.profitFactor === Infinity ? '∞' : formatPercent(displayStats.profitFactor)}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                    Lucro médio: ${formatPrice(displayStats.avgLucro)}
                  </p>
                </div>
                
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl shadow p-6 border border-purple-200 dark:border-purple-800">
                  <p className="text-sm text-purple-600 dark:text-purple-400 mb-1">Prejuízo Médio</p>
                  <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                    ${formatPrice(displayStats.avgPrejuizo)}
                  </p>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                    R:R médio: {displayStats.avgPrejuizo > 0 ? formatPercent(displayStats.avgLucro / displayStats.avgPrejuizo) : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Sequências e Extremos */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Maior Ganho</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    +${formatPrice(displayStats.maxGain)}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Maior Perda</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    ${formatPrice(displayStats.maxDrawdown)}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Sequência Atual</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {displayStats.currentStreak.count} {displayStats.currentStreak.type === 'win' ? 'Vitórias' : 'Derrotas'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Máx: {displayStats.maxWinStreak} vitórias | {displayStats.maxLossStreak} derrotas
                  </p>
                </div>
              </div>

              {/* Por Direção */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Compra (BUY)</h2>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Total:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{displayStats.buyStats.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Win Rate:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatPercent(displayStats.buyStats.winRate)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Lucro Líquido:</span>
                      <span className={`font-medium ${displayStats.buyStats.lucroLiquido >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {displayStats.buyStats.lucroLiquido >= 0 ? '+' : ''}${formatPrice(displayStats.buyStats.lucroLiquido)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Lucro Médio:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        ${formatPrice(displayStats.buyStats.avgLucro)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Prejuízo Médio:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        ${formatPrice(displayStats.buyStats.avgPrejuizo)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Venda (SELL)</h2>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Total:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{displayStats.sellStats.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Win Rate:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatPercent(displayStats.sellStats.winRate)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Lucro Líquido:</span>
                      <span className={`font-medium ${displayStats.sellStats.lucroLiquido >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {displayStats.sellStats.lucroLiquido >= 0 ? '+' : ''}${formatPrice(displayStats.sellStats.lucroLiquido)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Lucro Médio:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        ${formatPrice(displayStats.sellStats.avgLucro)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Prejuízo Médio:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        ${formatPrice(displayStats.sellStats.avgPrejuizo)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Distribuição de Resultados */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Distribuição de Resultados</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">0% a 5%</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{displayStats.resultDistribution['0-5%']}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">5% a 10%</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{displayStats.resultDistribution['5-10%']}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">10% a 20%</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{displayStats.resultDistribution['10-20%']}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">20%+</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{displayStats.resultDistribution['20%+']}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">0% a -5%</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{displayStats.resultDistribution['0 a -5%']}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">-5% a -10%</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{displayStats.resultDistribution['-5 a -10%']}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">-10% ou menos</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{displayStats.resultDistribution['-10% ou menos']}</p>
                  </div>
                </div>
              </div>

              {/* Por Estratégia */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Análise por Estratégia</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Estratégia</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Lucros</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Prejuízos</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Win Rate</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Lucro Líquido</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Profit Factor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {Object.entries(displayStats.byStrategy)
                        .sort((a, b) => b[1].lucroLiquido - a[1].lucroLiquido)
                        .map(([strategy, data]) => (
                          <tr key={strategy} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">{strategy}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{data.total}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{data.lucros}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{data.prejuizos}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{formatPercent(data.winRate)}%</td>
                            <td className={`px-3 py-2 text-sm font-medium ${data.lucroLiquido >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {data.lucroLiquido >= 0 ? '+' : ''}${formatPrice(data.lucroLiquido)}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                              {data.profitFactor === Infinity ? '∞' : formatPercent(data.profitFactor)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Por Timeframe */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Análise por Timeframe</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Timeframe</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Lucros</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Prejuízos</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Win Rate</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Lucro Líquido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {Object.entries(displayStats.byTimeframe)
                        .sort((a, b) => b[1].lucroLiquido - a[1].lucroLiquido)
                        .map(([tf, data]) => (
                          <tr key={tf} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">{tf}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{data.total}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{data.lucros}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{data.prejuizos}</td>
                            <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{formatPercent(data.winRate)}%</td>
                            <td className={`px-3 py-2 text-sm font-medium ${data.lucroLiquido >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {data.lucroLiquido >= 0 ? '+' : ''}${formatPrice(data.lucroLiquido)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Por Força */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Análise por Força do Sinal</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.entries(displayStats.byStrength).map(([range, data]) => (
                    <div key={range} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Força {range}</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Total:</span>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{data.total}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Lucros:</span>
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">{data.lucros}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Prejuízos:</span>
                          <span className="text-sm font-medium text-red-600 dark:text-red-400">{data.prejuizos}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Win Rate:</span>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{formatPercent(data.winRate)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Lucro Líquido:</span>
                          <span className={`text-sm font-medium ${data.lucroLiquido >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {data.lucroLiquido >= 0 ? '+' : ''}${formatPrice(data.lucroLiquido)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        })()}

        <Disclaimer />
      </main>
    </div>
  );
}

