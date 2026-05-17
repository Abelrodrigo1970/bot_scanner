import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  BUILTIN_UNIVERSE_META,
  getBuiltinScanDefinition,
} from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import { persistUniverseScan } from '@/lib/universeScanPersistence';

type RouteContext = { params: Promise<{ code: string }> };

/**
 * GET: último scan gravado para um `universeCode` (Scanner 1/2/3).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { code } = await context.params;
    const meta = BUILTIN_UNIVERSE_META[code];
    const def = getBuiltinScanDefinition(code);
    if (!meta || !def) {
      return NextResponse.json({ error: 'Scanner desconhecido' }, { status: 404 });
    }

    const run = await prisma.universeScanRun.findFirst({
      where: { universeCode: code },
      orderBy: { scannedAt: 'desc' },
      include: {
        rows: {
          orderBy: { pctFromMa: 'asc' },
        },
      },
    });

    return NextResponse.json({
      success: true,
      code,
      meta,
      definition: def,
      run: run
        ? {
            id: run.id,
            scannedAt: run.scannedAt.toISOString(),
            rowCount: run.rowCount,
            source: run.source,
          }
        : null,
      items: (run?.rows ?? []).map((r, i) => ({
        rank: i + 1,
        symbol: r.symbol,
        close: r.close,
        ma: r.ma,
        pctFromMa: r.pctFromMa,
      })),
      count: run?.rows.length ?? 0,
    });
  } catch (error) {
    console.error('GET universe-scans:', error);
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    const missingTable =
      message.includes('UniverseScanRun') || message.includes('does not exist');
    return NextResponse.json(
      {
        success: false,
        error: missingTable
          ? 'Tabelas UniverseScan ainda não existem na BD. Execute prisma/manual_railway_UniverseScan.sql'
          : 'Erro ao ler scan',
        details: message,
      },
      { status: missingTable ? 503 : 500 }
    );
  }
}

/**
 * POST: executa scan Binance e grava histórico na BD.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { code } = await context.params;
    const meta = BUILTIN_UNIVERSE_META[code];
    const def = getBuiltinScanDefinition(code);
    if (!meta || !def) {
      return NextResponse.json({ error: 'Scanner desconhecido' }, { status: 404 });
    }

    console.log(`[universe-scans] A executar ${code}...`);
    const rows = await scanSymbolUniverse(def);
    const persisted = await persistUniverseScan({
      universeCode: code,
      source: 'ui/universe-scans',
      rows,
    });

    if (!persisted.ok) {
      return NextResponse.json(
        {
          success: false,
          error: 'Scan concluído mas falhou ao gravar na BD',
          details: persisted.reason,
          count: rows.length,
        },
        { status: 503 }
      );
    }

    const saved = await prisma.universeScanRun.findUnique({
      where: { id: persisted.runId },
      include: { rows: { orderBy: { pctFromMa: 'asc' } } },
    });

    return NextResponse.json({
      success: true,
      code,
      meta,
      runId: persisted.runId,
      scannedAt: saved?.scannedAt.toISOString() ?? new Date().toISOString(),
      items: (saved?.rows ?? rows).map((r, i) => ({
        rank: i + 1,
        symbol: r.symbol,
        close: r.close,
        ma: r.ma,
        pctFromMa: r.pctFromMa,
      })),
      count: rows.length,
      message: `${meta.displayName} atualizado (${rows.length} símbolos)`,
    });
  } catch (error) {
    console.error('POST universe-scans:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
