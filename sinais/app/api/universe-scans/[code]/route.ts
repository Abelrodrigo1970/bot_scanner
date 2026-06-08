import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  BUILTIN_UNIVERSE_META,
  getBuiltinScanDefinition,
} from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import {
  buildScanItemsWithPreviousDelta,
  getLatestUniverseScanPair,
  persistUniverseScan,
} from '@/lib/universeScanPersistence';

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

    const pair = await getLatestUniverseScanPair(code);
    const run = pair.current;
    const items = run
      ? buildScanItemsWithPreviousDelta(run.rows, pair.previous?.rows ?? null)
      : [];

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
      previousRun: pair.previous
        ? { id: pair.previous.id, scannedAt: pair.previous.scannedAt.toISOString() }
        : null,
      items,
      count: items.length,
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

/** Guarda o job activo por universeCode para evitar duplicados. */
const activeScanJobs = new Map<string, Promise<void>>();

/**
 * POST: inicia scan Binance em background e devolve 202 imediatamente.
 * O cliente deve fazer polling ao GET para obter os resultados quando prontos.
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

    if (activeScanJobs.has(code)) {
      return NextResponse.json(
        {
          success: false,
          busy: true,
          message: `Scan ${code} já em execução. Aguarde e recarregue a página.`,
        },
        { status: 202 }
      );
    }

    const startedAt = new Date().toISOString();

    const job = (async () => {
      try {
        console.log(`[universe-scans UI] A executar ${code}...`);
        const rows = await scanSymbolUniverse(def);
        await persistUniverseScan({ universeCode: code, source: 'ui/universe-scans', rows });
        console.log(`[universe-scans UI] ${code}: ${rows.length} símbolos gravados`);
      } catch (err) {
        console.error(`[universe-scans UI] erro ${code}:`, err);
      } finally {
        activeScanJobs.delete(code);
      }
    })();

    activeScanJobs.set(code, job);

    return NextResponse.json(
      {
        success: true,
        background: true,
        code,
        startedAt,
        message: `Scan ${meta.displayName} iniciado em background. Recarregue a página em 2–3 minutos para ver os resultados.`,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('POST universe-scans:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao iniciar scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
