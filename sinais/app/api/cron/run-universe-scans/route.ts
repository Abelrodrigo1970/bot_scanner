import { NextRequest, NextResponse } from 'next/server';
import { BUILTIN_UNIVERSE_SCAN_4H } from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import { persistUniverseScan } from '@/lib/universeScanPersistence';
import { runScanner1Top5Pipeline } from '@/lib/scanner1Top8Strategy';
import { runScanner2Rsi80Top3LongPipeline } from '@/lib/scanner2Rsi80Top3LongStrategy';
import { runRsiVendidoPipeline } from '@/lib/rsiVendidoStrategy';

/**
 * Scanner 1 + Scanner 2 + Scanner 6 + rsi_vendido
 * + rotação Top 4 (inactiva) + RSI>80 Top 3 LONG + rsi_vendido LONG.
 * Short Leader descontinuado.
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

  for (const [code, def] of Object.entries(BUILTIN_UNIVERSE_SCAN_4H)) {
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
    const top8 = await runScanner1Top5Pipeline({
      logPrefix: '[Universe-Scans → Scanner2 Top4]',
    });
    console.log('[Universe-Scans] Scanner 2 Top 4:', top8);
  } catch (err) {
    console.error('[Universe-Scans] Scanner 2 Top 4 falhou:', err);
  }

  try {
    const rsi80 = await runScanner2Rsi80Top3LongPipeline({
      logPrefix: '[Universe-Scans → S2 RSI80 Top3 LONG]',
    });
    console.log('[Universe-Scans] Scanner 2 RSI>80 Top 3 LONG:', rsi80);
  } catch (err) {
    console.error('[Universe-Scans] Scanner 2 RSI>80 Top 3 LONG falhou:', err);
  }

  try {
    const rsiVendido = await runRsiVendidoPipeline({
      logPrefix: '[Universe-Scans → rsi_vendido LONG]',
    });
    console.log('[Universe-Scans] rsi_vendido LONG:', rsiVendido);
  } catch (err) {
    console.error('[Universe-Scans] rsi_vendido LONG falhou:', err);
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
          'Scanners + RSI>80 Top 3 LONG + rsi_vendido LONG iniciados em background.',
        startedAt,
        scanners: Object.keys(BUILTIN_UNIVERSE_SCAN_4H),
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
