import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface SignalRow {
  id: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  strength: number;
  result24h: number | null;
  high24h: number | null;
  low24h: number | null;
  price24h: number | null;
  status24h: string | null;
  extraInfo: string | null;
  generatedAt: Date;
  strategyName: string;
}

interface TradeResult {
  win: boolean;
  loss: boolean;
  breakeven: boolean;
  pnlPct: number;         // % P&L simulado usando high24h/low24h/price24h
  hitTp1: boolean;
  hitTp2: boolean;
  hitSl: boolean;
}

/**
 * Simula o resultado de um sinal com base em high24h / low24h / price24h.
 * Ordem de prioridade: SL > TP1 > TP2 (quem foi tocado primeiro não é sabido, 
 * mas usamos SL como prioridade máxima — se o SL foi tocado consideramos perda).
 */
function simulateTrade(sig: SignalRow): TradeResult {
  const { entryPrice, stopLoss, target1, target2, direction, high24h, low24h, price24h } = sig;
  if (!high24h || !low24h || !price24h || !entryPrice || entryPrice === 0) {
    return { win: false, loss: false, breakeven: true, pnlPct: 0, hitTp1: false, hitTp2: false, hitSl: false };
  }

  const isBuy = direction === 'BUY';
  const slPct  = Math.abs((stopLoss - entryPrice) / entryPrice);
  const tp1Pct = target1 ? Math.abs((target1 - entryPrice) / entryPrice) : 0;
  const tp2Pct = target2 ? Math.abs((target2 - entryPrice) / entryPrice) : 0;

  let hitSl  = false;
  let hitTp1 = false;
  let hitTp2 = false;

  if (isBuy) {
    hitSl  = low24h  <= stopLoss;
    hitTp1 = target1 ? high24h >= target1 : false;
    hitTp2 = target2 ? high24h >= target2 : false;
  } else {
    hitSl  = high24h >= stopLoss;
    hitTp1 = target1 ? low24h <= target1 : false;
    hitTp2 = target2 ? low24h <= target2 : false;
  }

  // SL tem prioridade (pior caso conservador)
  if (hitSl) {
    return { win: false, loss: true, breakeven: false, pnlPct: -slPct * 100, hitTp1, hitTp2, hitSl: true };
  }

  // Chegou a TP2
  if (hitTp2) {
    const pnl = tp2Pct * 100;
    return { win: true, loss: false, breakeven: false, pnlPct: pnl, hitTp1, hitTp2, hitSl: false };
  }

  // Chegou a TP1 mas não TP2 — saiu em TP1
  if (hitTp1) {
    const pnl = tp1Pct * 100;
    return { win: true, loss: false, breakeven: false, pnlPct: pnl, hitTp1, hitTp2: false, hitSl: false };
  }

  // Nenhum nível tocado — fecha ao preço de 24h
  const closePnl = isBuy
    ? ((price24h - entryPrice) / entryPrice) * 100
    : ((entryPrice - price24h) / entryPrice) * 100;
  return {
    win: closePnl > 0,
    loss: closePnl < 0,
    breakeven: closePnl === 0,
    pnlPct: closePnl,
    hitTp1: false,
    hitTp2: false,
    hitSl: false,
  };
}

interface ComboStats {
  buyFrom: number;
  buyTo:   number;
  sellFrom:number;
  sellTo:  number;
  signals: number;
  buy: number;
  sell: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  expectancy: number;
  avgStrength: number;
  withData: number;
}

function evalCombo(
  signals: SignalRow[],
  buyFrom:  number,
  buyTo:    number,
  sellFrom: number,
  sellTo:   number
): ComboStats {
  const filtered = signals.filter((s) => {
    let rsi: number | null = null;
    let prevRsi: number | null = null;
    if (s.extraInfo) {
      try {
        const info = JSON.parse(s.extraInfo);
        rsi     = parseFloat(info.rsi);
        prevRsi = parseFloat(info.prevRsi);
      } catch { /* ignore */ }
    }
    if (rsi === null || prevRsi === null || isNaN(rsi) || isNaN(prevRsi)) return false;

    if (s.direction === 'BUY') {
      // Sinal BUY: RSI cruzou buyTo vindo de abaixo de buyFrom
      return prevRsi <= buyFrom && rsi > buyTo;
    } else {
      // Sinal SELL: RSI cruzou sellTo vindo de acima de sellFrom
      return prevRsi >= sellFrom && rsi < sellTo;
    }
  });

  const withData = filtered.filter((s) => s.high24h && s.low24h && s.price24h);
  const results  = withData.map((s) => simulateTrade(s));
  const wins     = results.filter((r) => r.win).length;
  const losses   = results.filter((r) => r.loss).length;
  const totalPnl = results.reduce((sum, r) => sum + r.pnlPct, 0);
  const avgPnl   = withData.length > 0 ? totalPnl / withData.length : 0;
  const winRate  = withData.length > 0 ? (wins / withData.length) * 100 : 0;
  const avgWin   = results.filter((r) => r.win).reduce((s, r) => s + r.pnlPct, 0) / (wins || 1);
  const avgLoss  = results.filter((r) => r.loss).reduce((s, r) => s + r.pnlPct, 0) / (losses || 1);
  const expectancy = (winRate / 100) * avgWin + ((100 - winRate) / 100) * avgLoss;
  const avgStrength = filtered.length > 0
    ? filtered.reduce((s, sig) => s + sig.strength, 0) / filtered.length
    : 0;

  return {
    buyFrom, buyTo, sellFrom, sellTo,
    signals:    filtered.length,
    buy:        filtered.filter((s) => s.direction === 'BUY').length,
    sell:       filtered.filter((s) => s.direction === 'SELL').length,
    wins,
    losses,
    winRate:    Math.round(winRate * 10) / 10,
    avgPnl:     Math.round(avgPnl * 100) / 100,
    totalPnl:   Math.round(totalPnl * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    avgStrength:Math.round(avgStrength * 10) / 10,
    withData:   withData.length,
  };
}

/**
 * GET /api/backtest
 * Analisa todos os sinais RSI históricos e testa múltiplas combinações de thresholds.
 * Parâmetros query:
 *   - strategy=MA_CROSS_5M|MA200_VOLATILE|all (default: MA_CROSS_5M)
 *   - minSignals=5 (default: 3)
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const strategyFilter = searchParams.get('strategy') || 'RSI';
  const minSignals     = parseInt(searchParams.get('minSignals') || '3', 10);

  try {
    // ── Buscar dados históricos ──────────────────────────────────────────────
    const strategyNames = strategyFilter === 'all'
      ? ['MA200_VOLATILE', 'MA_CROSS_5M']
      : [strategyFilter];

    const strategies = await prisma.strategy.findMany({
      where: { name: { in: strategyNames } },
    });

    if (strategies.length === 0) {
      return NextResponse.json({ error: 'Estratégia não encontrada' }, { status: 404 });
    }

    const strategyIds = strategies.map((s) => s.id);

    const rawSignals = await prisma.signal.findMany({
      where: {
        strategyId: { in: strategyIds },
        status24h: 'CLOSED',
      },
      select: {
        id: true,
        symbol: true,
        direction: true,
        entryPrice: true,
        stopLoss: true,
        target1: true,
        target2: true,
        strength: true,
        result24h: true,
        high24h: true,
        low24h: true,
        price24h: true,
        status24h: true,
        extraInfo: true,
        generatedAt: true,
        strategyName: true,
      },
      orderBy: { generatedAt: 'desc' },
    });

    const signals = rawSignals as SignalRow[];

    // ── Estatísticas gerais da estratégia ────────────────────────────────────
    const overallStats = computeOverallStats(signals);

    // ── Backtesting RSI combos ───────────────────────────────────────────────
    let combos: ComboStats[] = [];
    if (strategyFilter === 'RSI' || strategyFilter === 'all') {
      const rsiSignals = signals.filter((s) => s.strategyName.toLowerCase().includes('rsi'));
      combos = testRsiCombinations(rsiSignals, minSignals);
    }

    // ── Análise por símbolo ──────────────────────────────────────────────────
    const bySymbol = computeBySymbol(signals);

    // ── Análise por direção ──────────────────────────────────────────────────
    const byDirection = computeByDirection(signals);

    // ── Top combinações ──────────────────────────────────────────────────────
    const topCombos = combos
      .sort((a, b) => b.expectancy - a.expectancy)
      .slice(0, 20);

    return NextResponse.json({
      meta: {
        strategy: strategyFilter,
        totalSignals: signals.length,
        withResults: signals.filter((s) => s.high24h && s.low24h).length,
        generatedAt: new Date().toISOString(),
      },
      overall: overallStats,
      byDirection,
      topSymbols: bySymbol.slice(0, 15),
      topRsiCombos: topCombos,
      worstRsiCombos: combos.sort((a, b) => a.expectancy - b.expectancy).slice(0, 5),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[Backtest] Erro:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeOverallStats(signals: SignalRow[]) {
  const withData = signals.filter((s) => s.high24h && s.low24h && s.price24h);
  const results  = withData.map((s) => simulateTrade(s));
  const wins     = results.filter((r) => r.win).length;
  const losses   = results.filter((r) => r.loss).length;
  const total    = results.length;
  const totalPnl = results.reduce((s, r) => s + r.pnlPct, 0);
  const avgPnl   = total > 0 ? totalPnl / total : 0;
  const winRate  = total > 0 ? (wins / total) * 100 : 0;
  const avgWin   = wins   > 0 ? results.filter((r) => r.win).reduce((s, r) => s + r.pnlPct, 0) / wins   : 0;
  const avgLoss  = losses > 0 ? results.filter((r) => r.loss).reduce((s, r) => s + r.pnlPct, 0) / losses : 0;
  const expectancy = (winRate / 100) * avgWin + ((100 - winRate) / 100) * avgLoss;
  const hitSlCount  = results.filter((r) => r.hitSl).length;
  const hitTp1Count = results.filter((r) => r.hitTp1).length;
  const hitTp2Count = results.filter((r) => r.hitTp2).length;

  return {
    total: signals.length,
    withData: total,
    wins,
    losses,
    breakeven: total - wins - losses,
    winRate:   Math.round(winRate * 10) / 10,
    avgPnl:    Math.round(avgPnl * 100) / 100,
    totalPnl:  Math.round(totalPnl * 100) / 100,
    avgWin:    Math.round(avgWin * 100) / 100,
    avgLoss:   Math.round(avgLoss * 100) / 100,
    expectancy:Math.round(expectancy * 100) / 100,
    hitSlRate: total > 0 ? Math.round((hitSlCount / total) * 1000) / 10 : 0,
    hitTp1Rate:total > 0 ? Math.round((hitTp1Count / total) * 1000) / 10 : 0,
    hitTp2Rate:total > 0 ? Math.round((hitTp2Count / total) * 1000) / 10 : 0,
  };
}

function computeByDirection(signals: SignalRow[]) {
  return ['BUY', 'SELL'].map((dir) => {
    const subset = signals.filter((s) => s.direction === dir);
    return { direction: dir, ...computeOverallStats(subset) };
  });
}

function computeBySymbol(signals: SignalRow[]) {
  const map: Record<string, SignalRow[]> = {};
  for (const s of signals) {
    if (!map[s.symbol]) map[s.symbol] = [];
    map[s.symbol].push(s);
  }
  return Object.entries(map)
    .map(([symbol, sigs]) => ({ symbol, ...computeOverallStats(sigs) }))
    .filter((s) => s.withData >= 2)
    .sort((a, b) => b.expectancy - a.expectancy);
}

/**
 * Testa combinações RSI:
 *   BUY  quando prevRsi <= buyFrom  E rsi > buyTo
 *   SELL quando prevRsi >= sellFrom E rsi < sellTo
 */
function testRsiCombinations(signals: SignalRow[], minSignals: number): ComboStats[] {
  const results: ComboStats[] = [];

  // Intervalos BUY: cruzamento de baixo para cima
  const buyFromValues = [40, 45, 48, 50, 52, 55, 60, 65];
  const buyToValues   = [45, 48, 50, 52, 55, 60, 65, 70, 75];

  // Intervalos SELL: cruzamento de cima para baixo
  const sellFromValues = [35, 40, 45, 48, 50, 52, 55, 60];
  const sellToValues   = [25, 28, 30, 32, 35, 40, 45, 48];

  for (const buyFrom of buyFromValues) {
    for (const buyTo of buyToValues) {
      if (buyTo <= buyFrom) continue;
      for (const sellFrom of sellFromValues) {
        for (const sellTo of sellToValues) {
          if (sellTo >= sellFrom) continue;
          const stat = evalCombo(signals, buyFrom, buyTo, sellFrom, sellTo);
          if (stat.signals >= minSignals) {
            results.push(stat);
          }
        }
      }
    }
  }

  return results;
}
