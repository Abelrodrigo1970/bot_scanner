import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BUILTIN_UNIVERSE_META } from '@/lib/symbolUniverseDefaults';

type RouteContext = { params: Promise<{ code: string }> };

/**
 * GET /api/universe-scans/[code]/history?top=5&limit=100
 *
 * Devolve todos os runs históricos gravados para o universeCode,
 * do mais recente para o mais antigo.
 * Cada run inclui os `top` primeiros símbolos (por pctFromMa desc)
 * com os seus preços de fecho.
 *
 * Usado para backtests: comprar top-N a cada ciclo e vender no ciclo seguinte.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { code } = await context.params;

    if (!BUILTIN_UNIVERSE_META[code]) {
      return NextResponse.json({ error: 'Scanner desconhecido' }, { status: 404 });
    }

    const url = new URL(request.url);
    const topN = Math.min(parseInt(url.searchParams.get('top') ?? '5', 10), 20);
    const limitRuns = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 100);

    const runs = await prisma.universeScanRun.findMany({
      where: { universeCode: code },
      orderBy: { scannedAt: 'desc' },
      take: limitRuns,
      include: {
        rows: {
          select: { symbol: true, close: true, ma: true, pctFromMa: true },
        },
      },
    });

    const result = runs.map((run) => {
      // Ordenar por pctFromMa desc (mesma lógica do scanner)
      const sorted = [...run.rows].sort((a, b) => b.pctFromMa - a.pctFromMa);
      const top = sorted.slice(0, topN).map((r, i) => ({
        rank: i + 1,
        symbol: r.symbol,
        close: r.close,
        ma: r.ma,
        pctFromMa: r.pctFromMa,
      }));
      return {
        runId: run.id,
        scannedAt: run.scannedAt.toISOString(),
        rowCount: run.rowCount,
        source: run.source,
        top,
      };
    });

    return NextResponse.json({
      success: true,
      code,
      meta: BUILTIN_UNIVERSE_META[code],
      topN,
      totalRuns: result.length,
      runs: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
