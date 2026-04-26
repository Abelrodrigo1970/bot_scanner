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
  winRate: number | null;
}

interface SignalLite {
  strategyName: string | null;
  direction: string;
  result24h: number | null;
  generatedAt: Date;
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

