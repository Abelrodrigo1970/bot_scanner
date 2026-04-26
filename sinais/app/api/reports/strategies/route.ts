import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';

type Direction = 'BUY' | 'SELL';

interface DirectionStats {
  total: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  breakeven: number;
  sum24h: number;
  avg24h: number | null;
  winRate: number | null;
}

interface SignalLite {
  strategyName: string | null;
  direction: string;
  result24h: number | null;
}

function computeDirectionStats(rows: SignalLite[]): DirectionStats {
  const total = rows.length;
  const closedRows = rows.filter((r) => r.result24h !== null);
  const closed = closedRows.length;
  const open = total - closed;
  const wins = closedRows.filter((r) => (r.result24h ?? 0) > 0).length;
  const losses = closedRows.filter((r) => (r.result24h ?? 0) < 0).length;
  const breakeven = closedRows.filter((r) => (r.result24h ?? 0) === 0).length;
  const sum24h = closedRows.reduce((acc, row) => acc + (row.result24h ?? 0), 0);
  const avg24h = closed > 0 ? sum24h / closed : null;
  const winRate = closed > 0 ? (wins / closed) * 100 : null;

  return {
    total,
    closed,
    open,
    wins,
    losses,
    breakeven,
    sum24h,
    avg24h,
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
      },
      select: {
        strategyName: true,
        direction: true,
        result24h: true,
      },
    });

    const grouped = new Map<
      string,
      {
        BUY: SignalLite[];
        SELL: SignalLite[];
      }
    >();

    for (const row of rows) {
      const strategy = row.strategyName || 'Sem nome';
      if (!grouped.has(strategy)) {
        grouped.set(strategy, { BUY: [], SELL: [] });
      }
      const dir: Direction = row.direction === 'SELL' ? 'SELL' : 'BUY';
      grouped.get(strategy)![dir].push(row);
    }

    const strategies = Array.from(grouped.entries())
      .map(([strategyName, dirs]) => ({
        strategyName,
        BUY: computeDirectionStats(dirs.BUY),
        SELL: computeDirectionStats(dirs.SELL),
      }))
      .sort((a, b) => a.strategyName.localeCompare(b.strategyName));

    return NextResponse.json({
      range: { dateFrom, dateTo },
      totalSignals: rows.length,
      strategies,
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

