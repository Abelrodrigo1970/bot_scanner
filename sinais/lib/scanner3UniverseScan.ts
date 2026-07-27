/**
 * Scanner 3 — RSI > 75 (1h). Corre a cada hora via cron run-scanner3-rsi-1h.
 */

import {
  UNIVERSE_CODE_SCANNER_3_RSI75_1H,
  getBuiltinScanDefinition,
} from './symbolUniverseDefaults';
import { scanSymbolUniverse } from './universeScanner';
import { persistUniverseScan } from './universeScanPersistence';

export type Scanner3ScanResult =
  | { status: 'done'; rowCount: number; runId?: string }
  | { status: 'failed'; reason: string };

export async function runScanner3Rsi1hScan(
  source = 'cron/run-scanner3-rsi-1h'
): Promise<Scanner3ScanResult> {
  const code = UNIVERSE_CODE_SCANNER_3_RSI75_1H;
  const def = getBuiltinScanDefinition(code);
  if (!def) {
    return { status: 'failed', reason: `Definição ${code} em falta` };
  }

  try {
    console.log(`[Scanner3 RSI 1h] A executar ${code}...`);
    const rows = await scanSymbolUniverse(def);
    const persist = await persistUniverseScan({
      universeCode: code,
      source,
      rows,
    });
    if (!persist.ok) {
      return { status: 'failed', reason: persist.reason };
    }
    console.log(`[Scanner3 RSI 1h] ${rows.length} símbolos gravados`);
    return { status: 'done', rowCount: rows.length, runId: persist.runId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[Scanner3 RSI 1h] Falhou:', reason);
    return { status: 'failed', reason };
  }
}

/** @deprecated Prefer runScanner3Rsi1hScan */
export const runScanner3Rsi15mScan = runScanner3Rsi1hScan;
