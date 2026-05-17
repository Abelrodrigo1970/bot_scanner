import { prisma } from './db';
import { scanSymbolUniverse } from './universeScanner';
import { getBuiltinScanDefinition } from './symbolUniverseDefaults';

const SCAN_HISTORY_KEEP = 25;

export type PersistUniverseScanInput = {
  universeCode: string;
  source: string;
  rows: Array<{ symbol: string; close: number; ma: number; pctFromMa: number }>;
};

export type PersistUniverseScanResult =
  | { ok: true; runId: string }
  | { ok: false; reason: string };

export async function persistUniverseScan(
  input: PersistUniverseScanInput
): Promise<PersistUniverseScanResult> {
  try {
    const runId = await prisma.$transaction(async (tx) => {
      const run = await tx.universeScanRun.create({
        data: {
          universeCode: input.universeCode,
          rowCount: input.rows.length,
          source: input.source,
        },
      });

      if (input.rows.length > 0) {
        await tx.universeScanRow.createMany({
          data: input.rows.map((r) => ({
            runId: run.id,
            symbol: r.symbol,
            close: r.close,
            ma: r.ma,
            pctFromMa: r.pctFromMa,
          })),
        });
      }

      const oldRuns = await tx.universeScanRun.findMany({
        where: { universeCode: input.universeCode },
        orderBy: { scannedAt: 'desc' },
        select: { id: true },
        skip: SCAN_HISTORY_KEEP,
      });
      if (oldRuns.length > 0) {
        await tx.universeScanRun.deleteMany({
          where: { id: { in: oldRuns.map((r) => r.id) } },
        });
      }

      return run.id;
    });

    return { ok: true, runId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[persistUniverseScan]', reason);
    return { ok: false, reason };
  }
}

export type LatestUniverseScanResult =
  | {
      ok: true;
      symbols: string[];
      runId: string;
      scannedAt: Date;
      rowCount: number;
    }
  | { ok: false; reason: string };

export async function getLatestUniverseScanSymbols(
  universeCode: string
): Promise<LatestUniverseScanResult> {
  try {
    const run = await prisma.universeScanRun.findFirst({
      where: { universeCode },
      orderBy: { scannedAt: 'desc' },
      select: {
        id: true,
        scannedAt: true,
        rowCount: true,
        rows: { select: { symbol: true } },
      },
    });
    if (!run) {
      return {
        ok: false,
        reason:
          'Nenhum scan gravado na BD. Execute /api/cron/run-universe-scans (ou aguarde o cron 1h) primeiro.',
      };
    }
    const symbols = run.rows.map((r) => r.symbol);
    return {
      ok: true,
      symbols,
      runId: run.id,
      scannedAt: run.scannedAt,
      rowCount: run.rowCount,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[getLatestUniverseScanSymbols]', reason);
    return { ok: false, reason };
  }
}

/** Último scan na BD ou scan em runtime + persistência se ainda não existir. */
export async function resolveUniverseScanSymbols(universeCode: string): Promise<string[]> {
  const latest = await getLatestUniverseScanSymbols(universeCode);
  if (latest.ok) {
    return latest.symbols;
  }

  const def = getBuiltinScanDefinition(universeCode);
  if (!def) {
    console.warn(`[resolveUniverseScanSymbols] definição desconhecida: ${universeCode}`);
    return [];
  }

  console.warn(
    `[resolveUniverseScanSymbols] ${universeCode}: sem scan na BD — a executar scan em runtime...`
  );
  const rows = await scanSymbolUniverse(def);
  const persisted = await persistUniverseScan({
    universeCode,
    source: 'resolveUniverseScanSymbols-fallback',
    rows,
  });
  if (!persisted.ok) {
    console.warn(`[resolveUniverseScanSymbols] falha ao gravar: ${persisted.reason}`);
  }
  return rows.map((r) => r.symbol);
}
