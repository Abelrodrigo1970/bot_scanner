import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';

const FEE_OPEN = 0.0005;
const FEE_CLOSE = 0.0005;
const TOTAL_FEE = FEE_OPEN + FEE_CLOSE;

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Buscar todos os sinais fechados com resultado 24h
    const signals = await prisma.signal.findMany({
      where: {
        status24h: 'CLOSED',
        result24h: { not: null },
        strength: { gte: 70 },
      },
      include: {
        strategy: true,
      },
      orderBy: { generatedAt: 'desc' },
    });

    // Calcular resultados com fees
    const signalsWithResults = signals.map((s) => {
      if (s.result24h === null) return { ...s, netResult: 0 };
      const grossResult = (s.result24h / s.entryPrice) * 100;
      const feeAmount = 100 * TOTAL_FEE;
      const netResult = grossResult - feeAmount;
      return { ...s, netResult };
    });

    // Agrupar por estratégia
    const byStrategy: Record<string, any> = {};
    
    signalsWithResults.forEach((s) => {
      const strategyName = s.strategyName;
      if (!byStrategy[strategyName]) {
        byStrategy[strategyName] = {
          name: strategyName,
          signals: [],
          total: 0,
          wins: 0,
          losses: 0,
          totalProfit: 0,
          totalLoss: 0,
          netProfit: 0,
          winRate: 0,
          profitFactor: 0,
          avgWin: 0,
          avgLoss: 0,
          maxWin: 0,
          maxLoss: 0,
          byTimeframe: {} as Record<string, any>,
          byDirection: { BUY: 0, SELL: 0 } as Record<string, number>,
        };
      }
      
      byStrategy[strategyName].signals.push(s);
      byStrategy[strategyName].total++;
      
      if (s.netResult >= 0) {
        byStrategy[strategyName].wins++;
        byStrategy[strategyName].totalProfit += s.netResult;
        byStrategy[strategyName].maxWin = Math.max(byStrategy[strategyName].maxWin, s.netResult);
      } else {
        byStrategy[strategyName].losses++;
        byStrategy[strategyName].totalLoss += Math.abs(s.netResult);
        byStrategy[strategyName].maxLoss = Math.min(byStrategy[strategyName].maxLoss, s.netResult);
      }
      
      // Por timeframe
      if (!byStrategy[strategyName].byTimeframe[s.timeframe]) {
        byStrategy[strategyName].byTimeframe[s.timeframe] = { total: 0, wins: 0, losses: 0, netProfit: 0 };
      }
      byStrategy[strategyName].byTimeframe[s.timeframe].total++;
      if (s.netResult >= 0) {
        byStrategy[strategyName].byTimeframe[s.timeframe].wins++;
        byStrategy[strategyName].byTimeframe[s.timeframe].netProfit += s.netResult;
      } else {
        byStrategy[strategyName].byTimeframe[s.timeframe].losses++;
        byStrategy[strategyName].byTimeframe[s.timeframe].netProfit += s.netResult;
      }
      
      // Por direção
      byStrategy[strategyName].byDirection[s.direction]++;
    });

    // Calcular métricas finais
    Object.keys(byStrategy).forEach((strategyName) => {
      const strategy = byStrategy[strategyName];
      strategy.winRate = strategy.total > 0 ? (strategy.wins / strategy.total) * 100 : 0;
      strategy.profitFactor = strategy.totalLoss > 0 ? strategy.totalProfit / strategy.totalLoss : strategy.totalProfit > 0 ? Infinity : 0;
      strategy.avgWin = strategy.wins > 0 ? strategy.totalProfit / strategy.wins : 0;
      strategy.avgLoss = strategy.losses > 0 ? strategy.totalLoss / strategy.losses : 0;
      strategy.netProfit = strategy.totalProfit - strategy.totalLoss;
      
      // Remover array de sinais para reduzir tamanho da resposta
      delete strategy.signals;
    });

    // Estatísticas gerais
    const totalSignals = signalsWithResults.length;
    const totalWins = signalsWithResults.filter(s => s.netResult >= 0).length;
    const totalLosses = totalSignals - totalWins;
    const totalProfit = signalsWithResults.filter(s => s.netResult >= 0).reduce((sum, s) => sum + s.netResult, 0);
    const totalLoss = Math.abs(signalsWithResults.filter(s => s.netResult < 0).reduce((sum, s) => sum + s.netResult, 0));
    const overallWinRate = totalSignals > 0 ? (totalWins / totalSignals) * 100 : 0;
    const overallProfitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

    // Ordenar estratégias por lucro líquido
    const strategiesArray = Object.values(byStrategy).sort((a: any, b: any) => b.netProfit - a.netProfit);

    return NextResponse.json({
      summary: {
        totalSignals,
        totalWins,
        totalLosses,
        overallWinRate: parseFloat(overallWinRate.toFixed(2)),
        overallProfitFactor: overallProfitFactor === Infinity ? 'Infinity' : parseFloat(overallProfitFactor.toFixed(2)),
        totalNetProfit: parseFloat((totalProfit - totalLoss).toFixed(2)),
      },
      strategies: strategiesArray,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao analisar estratégias:', error);
    return NextResponse.json(
      {
        error: 'Erro ao analisar estratégias',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

