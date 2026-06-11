import { NextRequest, NextResponse } from 'next/server';
import { BUILTIN_UNIVERSE_SCAN } from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import { persistUniverseScan } from '@/lib/universeScanPersistence';
import { runScanner1Top8Pipeline } from '@/lib/scanner1Top8Strategy';
import { runScannerMa80Top6Pipeline } from '@/lib/scannerMa80Top6Strategy';
import { runScannerMa804hTop6Pipeline } from '@/lib/scannerMa804hTop6Strategy';

/**
 * Executa os scanners de universo (MA200 1h/1d, EMA80 1d/4h, EMA80 -5/+15%, ±4% MA80) e grava na BD.
 * Resposta imediata 202 — trabalho pesado em background (evita timeout do cron-job.org).
 * Agendar de 4 em 4 horas (00:00, 04:00, 08:00, …).
 */
let universeScansJobPromise: Promise<void> | null = null;

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

  try {
    const top8 = await runScanner1Top8Pipeline({
      logPrefix: '[Universe-Scans → Top8]',
    });
    console.log('[Universe-Scans] Scanner 1 Top 8:', top8);
  } catch (err) {
    console.error('[Universe-Scans] Scanner 1 Top 8 falhou:', err);
  }

  try {
    const ma80 = await runScannerMa80Top6Pipeline({
      logPrefix: '[Universe-Scans → MA80 Top6]',
    });
    console.log('[Universe-Scans] Scanner 5 MA80 Top 6:', ma80);
  } catch (err) {
    console.error('[Universe-Scans] Scanner 5 MA80 Top 6 falhou:', err);
  }

  try {
    const ma804h = await runScannerMa804hTop6Pipeline({
      logPrefix: '[Universe-Scans → MA80 4h Top6]',
    });
    console.log('[Universe-Scans] Scanner 6 MA80 4h Top 6:', ma804h);
  } catch (err) {
    console.error('[Universe-Scans] Scanner 6 MA80 4h Top 6 falhou:', err);
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
            'Scanners 1/2/3/4/5/6 já em execução em background. Aguarde a conclusão (pode demorar 15–30 min).',
          startedAt: new Date().toISOString(),
        },
        { status: 202 }
      );
    }

    const startedAt = new Date().toISOString();

    universeScansJobPromise = (async () => {
      try {
        const results = await runUniverseScansJob();
        console.log('[Universe-Scans] concluído', { startedAt, results });
      } catch (err) {
        console.error('[Universe-Scans] erro em background:', err);
      } finally {
        universeScansJobPromise = null;
      }
    })();

    return NextResponse.json(
      {
        accepted: true,
        background: true,
        message:
          'Scanners 1, 2, 3 e 4 iniciados em background. O teste no cron-job.org deve responder já; verifique os logs no Railway para conclusão.',
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
