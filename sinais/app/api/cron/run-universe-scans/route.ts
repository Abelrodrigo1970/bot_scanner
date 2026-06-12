import { NextRequest, NextResponse } from 'next/server';
import { BUILTIN_UNIVERSE_SCAN } from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import { persistUniverseScan } from '@/lib/universeScanPersistence';

/**
 * Scanner 1 (universo MA Cross + Pivot Boss 15m). Agendar de 4 em 4 horas.
 */
let universeScansJobPromise: Promise<void> | null = null;
let universeScansJobStartedAt: string | null = null;

type ScanJobResult = {
  universeCode: string;
  rowCount: number;
  persist: { ok: boolean; runId?: string; reason?: string };
};

async function runUniverseScansJob(): Promise<ScanJobResult[]> {
  const results: ScanJobResult[] = [];

  for (const [code, def] of Object.entries(BUILTIN_UNIVERSE_SCAN)) {
    console.log(`[Universe-Scans] A executar ${code}...`);
    const rows = await scanSymbolUniverse(def);
    const persist = await persistUniverseScan({
      universeCode: code,
      source: 'cron/run-universe-scans',
      rows,
    });
    results.push({
      universeCode: code,
      rowCount: rows.length,
      persist: persist.ok
        ? { ok: true, runId: persist.runId }
        : { ok: false, reason: persist.reason },
    });
    console.log(`[Universe-Scans] ${code}: ${rows.length} símbolos`);
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (universeScansJobPromise) {
      return NextResponse.json(
        {
          accepted: false,
          busy: true,
          message:
            'Scanner 1 já em execução em background. Aguarde a conclusão (pode demorar vários minutos).',
          startedAt: universeScansJobStartedAt,
        },
        { status: 202 }
      );
    }

    const startedAt = new Date().toISOString();
    universeScansJobStartedAt = startedAt;

    universeScansJobPromise = (async () => {
      try {
        const results = await runUniverseScansJob();
        console.log('[Universe-Scans] concluído', { startedAt, results });
      } catch (err) {
        console.error('[Universe-Scans] erro em background:', err);
      } finally {
        universeScansJobPromise = null;
        universeScansJobStartedAt = null;
      }
    })();

    return NextResponse.json(
      {
        accepted: true,
        background: true,
        message:
          'Scanner 1 iniciado em background. Verifique os logs no Railway para conclusão.',
        startedAt,
        scanners: Object.keys(BUILTIN_UNIVERSE_SCAN),
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[Universe-Scans] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar scanners de universo',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
