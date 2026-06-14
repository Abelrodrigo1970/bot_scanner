import { prisma } from './db';
import { scanSymbolUniverse } from './universeScanner';
import { BUILTIN_UNIVERSE_SCAN, getBuiltinScanDefinition, isVolumeRankUniverseScan } from './symbolUniverseDefaults';
import { filterToBybitMarketSymbols } from './marketData';

const SCAN_HISTORY_KEEP = 100;

export type UniverseScanRowSnapshot = {
  symbol: string;
  close: number;
  ma: number;
  pctFromMa: number;
};

export type UniverseScanRowWithDelta = UniverseScanRowSnapshot & {
  rank: number;
  /** Variação do fecho vs scan anterior (%). null = sem scan anterior ou símbolo novo. */
  closeChangePct: number | null;
  /** Δ pontos na distância à média (pct actual − pct anterior). */
  pctFromMaDelta: number | null;
  /** Afastamento (% vs MA) no scan anterior. null = sem scan anterior ou símbolo novo. */
  pctFromMaPrev: number | null;
  /** Entrou no universo desde o scan anterior. */
  isNewInUniverse: boolean;
};

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
        rows: { select: { symbol: true }, orderBy: { id: 'asc' } },
      },
    });
    if (!run) {
      return {
        ok: false,
        reason:
          'Nenhum scan gravado na BD. Execute /api/cron/run-universe-scans (cron 4 h) ou Actualizar scan nesta página.',
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

export type EnsureUniverseScanResult = {
  universeCode: string;
  action: 'skipped' | 'scanned' | 'failed';
  rowCount: number;
  persistOk?: boolean;
  reason?: string;
};

/**
 * Garante que os scanners builtin (1, 2, 4) têm pelo menos um run na BD.
 * Chamado antes de gerar sinais para não depender só do cron de 4 h.
 */
export async function ensureAllBuiltinUniverseScans(
  source: string
): Promise<EnsureUniverseScanResult[]> {
  const results: EnsureUniverseScanResult[] = [];

  for (const [code, def] of Object.entries(BUILTIN_UNIVERSE_SCAN)) {
    const latest = await getLatestUniverseScanSymbols(code);
    if (latest.ok && latest.rowCount > 0) {
      results.push({
        universeCode: code,
        action: 'skipped',
        rowCount: latest.rowCount,
      });
      continue;
    }

    console.log(`[ensureUniverseScans] ${code}: sem dados — a executar scan...`);
    try {
      const rows = await scanSymbolUniverse(def);
      const persist = await persistUniverseScan({
        universeCode: code,
        source,
        rows,
      });
      results.push({
        universeCode: code,
        action: persist.ok ? 'scanned' : 'failed',
        rowCount: rows.length,
        persistOk: persist.ok,
        reason: persist.ok ? undefined : persist.reason,
      });
      console.log(
        `[ensureUniverseScans] ${code}: ${rows.length} símbolos` +
          (persist.ok ? '' : ` (falha ao gravar: ${persist.reason})`)
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[ensureUniverseScans] ${code} falhou:`, reason);
      results.push({ universeCode: code, action: 'failed', rowCount: 0, reason });
    }
  }

  return results;
}

/** Último scan na BD ou scan em runtime + persistência se ainda não existir. */
export async function resolveUniverseScanSymbols(universeCode: string): Promise<string[]> {
  const latest = await getLatestUniverseScanSymbols(universeCode);
  if (latest.ok) {
    return filterToBybitMarketSymbols(latest.symbols);
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
  return filterToBybitMarketSymbols(rows.map((r) => r.symbol));
}

/** Top N símbolos do último scan Scanner (|pctFromMa| desc), filtrados Bybit. */
export async function resolveUniverseScanSymbolsTopN(
  universeCode: string,
  topN: number
): Promise<string[]> {
  const n = Math.max(1, Math.floor(topN));
  let ranked = await getTopRankedUniverseScanRows(universeCode, n);
  if (!ranked.ok) {
    await resolveUniverseScanSymbols(universeCode);
    ranked = await getTopRankedUniverseScanRows(universeCode, n);
  }
  if (!ranked.ok) {
    console.warn(`[resolveUniverseScanSymbolsTopN] ${universeCode}: ${ranked.reason}`);
    return [];
  }
  return filterToBybitMarketSymbols(ranked.rows.map((r) => r.symbol));
}

function previousRowMap(
  rows: Array<{ symbol: string; close: number; pctFromMa: number }>
): Map<string, { close: number; pctFromMa: number }> {
  const m = new Map<string, { close: number; pctFromMa: number }>();
  for (const r of rows) {
    m.set(r.symbol, { close: r.close, pctFromMa: r.pctFromMa });
  }
  return m;
}

/** Compara linhas do scan actual com o run imediatamente anterior (mesmo universeCode). */
export function buildScanItemsWithPreviousDelta(
  currentRows: UniverseScanRowSnapshot[],
  previousRows: UniverseScanRowSnapshot[] | null | undefined
): UniverseScanRowWithDelta[] {
  const prev = previousRows?.length ? previousRowMap(previousRows) : null;
  const prevSymbols = prev ? new Set(prev.keys()) : new Set<string>();

  return currentRows.map((r, i) => {
    const p = prev?.get(r.symbol);
    let closeChangePct: number | null = null;
    let pctFromMaDelta: number | null = null;
    let pctFromMaPrev: number | null = null;

    if (p) {
      pctFromMaPrev = p.pctFromMa;
      pctFromMaDelta = r.pctFromMa - p.pctFromMa;
      if (p.close > 0) {
        closeChangePct = ((r.close - p.close) / p.close) * 100;
      }
    }

    return {
      rank: i + 1,
      symbol: r.symbol,
      close: r.close,
      ma: r.ma,
      pctFromMa: r.pctFromMa,
      closeChangePct,
      pctFromMaDelta,
      pctFromMaPrev,
      isNewInUniverse: prev !== null && !prevSymbols.has(r.symbol),
    };
  });
}

export type UniverseScanRunsPair = {
  current: {
    id: string;
    scannedAt: Date;
    rowCount: number;
    source: string;
    rows: UniverseScanRowSnapshot[];
  } | null;
  previous: {
    id: string;
    scannedAt: Date;
    rows: UniverseScanRowSnapshot[];
  } | null;
};

/** Último scan e o anterior (para Δ na UI). */
export async function getLatestUniverseScanPair(
  universeCode: string
): Promise<UniverseScanRunsPair> {
  const runs = await prisma.universeScanRun.findMany({
    where: { universeCode },
    orderBy: { scannedAt: 'desc' },
    take: 2,
    include: {
      rows: {
        select: { symbol: true, close: true, ma: true, pctFromMa: true },
        orderBy: { id: 'asc' },
      },
    },
  });

  const toSnap = (
    rows: Array<{ symbol: string; close: number; ma: number; pctFromMa: number }>
  ): UniverseScanRowSnapshot[] =>
    rows.map((r) => ({
      symbol: r.symbol,
      close: r.close,
      ma: r.ma,
      pctFromMa: r.pctFromMa,
    }));

  const [cur, prev] = runs;
  if (!cur) {
    return { current: null, previous: null };
  }

  const preserveRankOrder = isVolumeRankUniverseScan(universeCode);
  const currentRows = preserveRankOrder
    ? toSnap(cur.rows)
    : toSnap(cur.rows).sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));

  return {
    current: {
      id: cur.id,
      scannedAt: cur.scannedAt,
      rowCount: cur.rowCount,
      source: cur.source,
      rows: currentRows,
    },
    previous: prev
      ? {
          id: prev.id,
          scannedAt: prev.scannedAt,
          rows: toSnap(prev.rows),
        }
      : null,
  };
}

export type TopRankedUniverseScanResult =
  | {
      ok: true;
      runId: string;
      scannedAt: Date;
      rowCount: number;
      rows: UniverseScanRowWithDelta[];
    }
  | { ok: false; reason: string };

/** Top N símbolos do último scan (|pctFromMa| desc, ou ordem de rank para volume 24h). */
export async function getTopRankedUniverseScanRows(
  universeCode: string,
  topN: number
): Promise<TopRankedUniverseScanResult> {
  const pair = await getLatestUniverseScanPair(universeCode);
  if (!pair.current) {
    return {
      ok: false,
      reason:
        'Nenhum scan gravado na BD. Execute /api/cron/run-universe-scans ou Actualizar scan.',
    };
  }

  const ranked = buildScanItemsWithPreviousDelta(pair.current.rows, pair.previous?.rows);
  const n = Math.max(1, Math.floor(topN));

  return {
    ok: true,
    runId: pair.current.id,
    scannedAt: pair.current.scannedAt,
    rowCount: pair.current.rowCount,
    rows: isVolumeRankUniverseScan(universeCode)
      ? ranked.slice(0, n)
      : [...ranked].sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa)).slice(0, n),
  };
}
