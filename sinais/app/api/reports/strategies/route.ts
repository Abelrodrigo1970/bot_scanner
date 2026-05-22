import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';
import { getPositionSizeUsdt } from '@/lib/binanceConfig';

/** Alinhado ao mínimo de execução automática (tradingRules MIN_STRENGTH = 60). */
export const REPORT_DEFAULT_MIN_STRENGTH = 60;

type Direction = 'BUY' | 'SELL';

interface DirectionStats {
  total: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  breakeven: number;
  sum24h: number;
  winRate: number | null;
}

interface SignalLite {
  strategyName: string | null;
  direction: string;
  result24h: number | null;
  entryPrice: number;
  strength: number;
  status24h: string | null;
  generatedAt: Date;
}

function computeDirectionStats(rows: SignalLite[]): DirectionStats {
  const total = rows.length;
  const closedRows = rows;
  const closed = closedRows.length;
  const open = total - closed;
  const positionSizeUsdt = getPositionSizeUsdt();
  const feeAmountUsdt = positionSizeUsdt * 0.001; // 0.05% entrada + 0.05% saída
  const netResultsUsd = closedRows.map((row) => {
    const grossPct = (row.result24h ?? 0) / row.entryPrice;
    const grossUsd = grossPct * positionSizeUsdt;
    return grossUsd - feeAmountUsdt;
  });
  const wins = netResultsUsd.filter((v) => v >= 0).length;
  const losses = netResultsUsd.filter((v) => v < 0).length;
  const breakeven = 0;
  const sum24h = netResultsUsd.reduce((acc, v) => acc + v, 0);
  const winRate = closed > 0 ? (wins / closed) * 100 : null;

  return {
    total,
    closed,
    open,
    wins,
    losses,
    breakeven,
    sum24h,
    winRate,
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Verifique DATABASE_URL e tente /api/init-db ou /api/health para diagnóstico.',
        },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const strategy = (searchParams.get('strategy') || '').trim();
    const minStrengthParam = searchParams.get('minStrength');
    const minStrengthParsed =
      minStrengthParam != null && minStrengthParam !== ''
        ? parseInt(minStrengthParam, 10)
        : REPORT_DEFAULT_MIN_STRENGTH;
    const minStrength = Number.isFinite(minStrengthParsed)
      ? Math.min(100, Math.max(0, minStrengthParsed))
      : REPORT_DEFAULT_MIN_STRENGTH;

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'Parâmetros obrigatórios: dateFrom e dateTo (YYYY-MM-DD).' },
        { status: 400 }
      );
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: 'Datas inválidas. Use o formato YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    if (from > to) {
      return NextResponse.json(
        { error: 'dateFrom não pode ser maior que dateTo.' },
        { status: 400 }
      );
    }

    const rows: SignalLite[] = await prisma.signal.findMany({
      where: {
        generatedAt: {
          gte: from,
          lte: to,
        },
        status24h: 'CLOSED',
        result24h: { not: null },
        strength: { gte: minStrength },
        ...(strategy
          ? {
              strategyName: {
                contains: strategy,
              },
            }
          : {}),
      },
      select: {
        strategyName: true,
        direction: true,
        result24h: true,
        entryPrice: true,
        strength: true,
        status24h: true,
        generatedAt: true,
      },
    });

    const grouped = new Map<string, SignalLite[]>();
    for (const row of rows) {
      const day = row.generatedAt.toISOString().slice(0, 10);
      const strategy = row.strategyName || 'Sem nome';
      const dir: Direction = row.direction === 'SELL' ? 'SELL' : 'BUY';
      const key = `${day}__${strategy}__${dir}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    const reportRows = Array.from(grouped.entries())
      .map(([key, values]) => {
        const [day, strategyName, direction] = key.split('__');
        const stats = computeDirectionStats(values);
        return {
          day,
          strategyName,
          direction,
          nr: stats.total,
          winRate: stats.winRate,
          lucro: stats.sum24h,
          wins: stats.wins,
          losses: stats.losses,
          breakeven: stats.breakeven,
          closed: stats.closed,
          open: stats.open,
        };
      })
      .sort((a, b) => {
        if (a.day !== b.day) return a.day.localeCompare(b.day);
        if (a.strategyName !== b.strategyName) return a.strategyName.localeCompare(b.strategyName);
        return a.direction.localeCompare(b.direction);
      });

    return NextResponse.json({
      range: { dateFrom, dateTo },
      minStrength,
      totalSignals: rows.length,
      rows: reportRows,
    });
  } catch (error) {
    console.error('Erro ao gerar relatório por intervalo:', error);
    return NextResponse.json(
      {
        error: 'Erro ao gerar relatório por intervalo',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

