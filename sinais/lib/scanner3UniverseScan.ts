/**
 * Scanner 3 — RSI > 75 (15m). Corre a cada 15 min via cron run-15m.
 */

import {
  UNIVERSE_CODE_SCANNER_3_RSI75_15M,
  getBuiltinScanDefinition,
} from './symbolUniverseDefaults';
import { scanSymbolUniverse } from './universeScanner';
import { persistUniverseScan } from './universeScanPersistence';

export type Scanner3ScanResult =
  | { status: 'done'; rowCount: number; runId?: string }
  | { status: 'failed'; reason: string };

export async function runScanner3Rsi15mScan(
  source = 'cron/run-15m'
): Promise<Scanner3ScanResult> {
  const code = UNIVERSE_CODE_SCANNER_3_RSI75_15M;
  const def = getBuiltinScanDefinition(code);
  if (!def) {
    return { status: 'failed', reason: `Definição ${code} em falta` };
  }

  try {
    console.log(`[Scanner3 RSI 15m] A executar ${code}...`);
    const rows = await scanSymbolUniverse(def);
    const persist = await persistUniverseScan({
      universeCode: code,
      source,
      rows,
    });
    if (!persist.ok) {
      return { status: 'failed', reason: persist.reason };
    }
    console.log(`[Scanner3 RSI 15m] ${rows.length} símbolos gravados`);
    return { status: 'done', rowCount: rows.length, runId: persist.runId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[Scanner3 RSI 15m] Falhou:', reason);
    return { status: 'failed', reason };
  }
}
