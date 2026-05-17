import { NextRequest, NextResponse } from 'next/server';
import { BUILTIN_UNIVERSE_SCAN } from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import { persistUniverseScan } from '@/lib/universeScanPersistence';

/**
 * Executa os 3 scanners de universo (MA200+, ±10% MA80, ±4% MA80) e grava na BD.
 * Agendar no cron-job.org de 4 em 4 horas (minuto 0: 00:00, 04:00, 08:00, …).
 * Não está no agregado run-1h; as estratégias usam o último scan até ao próximo ciclo.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const results: Array<{
      universeCode: string;
      rowCount: number;
      persist: { ok: boolean; runId?: string; reason?: string };
    }> = [];

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

    return NextResponse.json({
      success: true,
      executedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('[Universe-Scans] Erro:', error);
    return NextResponse.json(
      {
        error: 'Erro ao executar scanners de universo',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
