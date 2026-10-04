import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchBybitClosedPnl } from '@/lib/bybitFuturesClient';
import { hasBybitCredentials } from '@/lib/bybitConfig';

export const dynamic = 'force-dynamic';

/**
 * Cruza closed-pnl Bybit com sinais rsi_vendido e devolve os piores trades executados.
 * Query: ?days=15&limit=10
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!hasBybitCredentials()) {
      return NextResponse.json({ error: 'Bybit credentials em falta' }, { status: 503 });
    }

    const days = Math.max(
      1,
      Math.min(60, Math.floor(Number(request.nextUrl.searchParams.get('days') || 15)))
    );
    const limit = Math.max(
      1,
      Math.min(50, Math.floor(Number(request.nextUrl.searchParams.get('limit') || 10)))
    );

    const endTimeMs = Date.now();
    const startTimeMs = endTimeMs - days * 86400000;

    const [closed, signals] = await Promise.all([
      fetchBybitClosedPnl({ startTimeMs, endTimeMs }),
      prisma.signal.findMany({
        where: {
          strategy: { name: 'RSI_VENDIDO_4H' },
          generatedAt: {
            gte: new Date(startTimeMs),
            lte: new Date(endTimeMs),
          },
        },
        select: {
          id: true,
          symbol: true,
          entryPrice: true,
          stopLoss: true,
          status: true,
          strength: true,
          generatedAt: true,
          extraInfo: true,
        },
        orderBy: { generatedAt: 'asc' },
      }),
    ]);

    const bySym = new Map<string, typeof closed>();
    for (const row of closed) {
      const list = bySym.get(row.symbol) || [];
      list.push(row);
      bySym.set(row.symbol, list);
    }

    const used = new Set<string>();
    const matched: Array<{
      symbol: string;
      signalId: string;
      signalEntry: number;
      bybitEntry: number;
      bybitExit: number;
      pnlPct: number;
      closedPnlUsdt: number;
      signalAt: string;
      closedAt: string;
      status: string;
      strength: number;
    }> = [];

    for (const s of signals) {
      const list = bySym.get(s.symbol) || [];
      const sigT = s.generatedAt.getTime();
      const candidates = list.filter((c) => {
        const key = `${c.orderId}:${c.updatedTime}`;
        if (used.has(key)) return false;
        if (String(c.side) !== 'Sell') return false;
        const avgEntry = Number(c.avgEntryPrice);
        if (!(avgEntry > 0) || !(s.entryPrice > 0)) return false;
        const entryOk = Math.abs(avgEntry / s.entryPrice - 1) <= 0.05;
        const created = Number(c.createdTime);
        const tOk = created >= sigT - 60 * 60000 && created <= sigT + 10 * 86400000;
        return entryOk && tOk;
      });
      if (!candidates.length) continue;
      candidates.sort(
        (a, b) =>
          Math.abs(Number(a.avgEntryPrice) - s.entryPrice) -
          Math.abs(Number(b.avgEntryPrice) - s.entryPrice)
      );
      const c = candidates[0]!;
      used.add(`${c.orderId}:${c.updatedTime}`);
      const avgEntry = Number(c.avgEntryPrice);
      const avgExit = Number(c.avgExitPrice);
      const pnlPct = ((avgExit - avgEntry) / avgEntry) * 100;
      matched.push({
        symbol: s.symbol,
        signalId: s.id,
        signalEntry: s.entryPrice,
        bybitEntry: avgEntry,
        bybitExit: avgExit,
        pnlPct: +pnlPct.toFixed(2),
        closedPnlUsdt: +Number(c.closedPnl).toFixed(2),
        signalAt: s.generatedAt.toISOString(),
        closedAt: new Date(Number(c.updatedTime)).toISOString(),
        status: s.status,
        strength: s.strength,
      });
    }

    matched.sort((a, b) => a.pnlPct - b.pnlPct);
    const worst = matched.slice(0, limit);

    return NextResponse.json({
      success: true,
      days,
      closedPnlRows: closed.length,
      rsiSignals: signals.length,
      matchedExecuted: matched.length,
      worst,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[rsi-vendido-bybit-worst]', error);
    return NextResponse.json(
      {
        error: 'Erro ao cruzar Bybit closed-pnl com rsi_vendido',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
