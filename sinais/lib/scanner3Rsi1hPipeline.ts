/**
 * Pipeline horário: scan Scanner 3 (RSI>75 1h) + sinais SCANNER3_RSI_BREAKOUT_15M.
 */

import { runScanner3Rsi1hScan } from '@/lib/scanner3UniverseScan';
import {
  runAllStrategies,
  type RunAllStrategiesOptions,
} from '@/lib/signalEngine';
import { cleanupBybitOrphanOpenOrders } from '@/lib/tradingExecutor';
import { update24hResults } from '@/lib/update24hResults';

export type Scanner3Rsi1hPipelineResult = {
  scan: Awaited<ReturnType<typeof runScanner3Rsi1hScan>>;
  signalsCreated: number;
};

export async function runScanner3Rsi1hPipeline(options?: {
  skipScan?: boolean;
}): Promise<Scanner3Rsi1hPipelineResult> {
  const scan = options?.skipScan
    ? ({ status: 'done' as const, rowCount: 0 })
    : await runScanner3Rsi1hScan('cron/run-scanner3-rsi-1h');

  if (scan.status === 'failed') {
    console.warn(
      `[Scanner3 RSI 1h] Scan falhou: ${scan.reason} — a tentar sinais com último universo`
    );
  }

  try {
    await update24hResults();
  } catch (e) {
    console.warn('[Scanner3 RSI 1h] update24hResults:', e);
  }

  const runOpts: RunAllStrategiesOptions = {
    only: ['SCANNER3_RSI_BREAKOUT_15M'],
  };

  let signalsCreated = 0;
  try {
    signalsCreated = await runAllStrategies(runOpts);
  } catch (e) {
    console.error('[Scanner3 RSI 1h] runAllStrategies falhou:', e);
  }

  try {
    await cleanupBybitOrphanOpenOrders();
  } catch {
    /* optional */
  }

  return { scan, signalsCreated };
}
