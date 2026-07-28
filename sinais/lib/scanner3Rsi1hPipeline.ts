/**
 * Pipeline horário: scan Scanner 3 (RSI>75 1h) + estratégia RSI Flip
 * (LONG 15m ao entrar / SHORT 15m se RSI 15m < 70).
 */

import { runScanner3Rsi1hScan } from '@/lib/scanner3UniverseScan';
import { runScanner3RsiFlip1hPipeline } from '@/lib/scanner3RsiFlip1hStrategy';
import { cleanupBybitOrphanOpenOrders } from '@/lib/tradingExecutor';
import { update24hResults } from '@/lib/update24hResults';

export type Scanner3Rsi1hPipelineResult = {
  scan: Awaited<ReturnType<typeof runScanner3Rsi1hScan>>;
  flip: Awaited<ReturnType<typeof runScanner3RsiFlip1hPipeline>>;
};

export async function runScanner3Rsi1hPipeline(options?: {
  skipScan?: boolean;
  forceFlip?: boolean;
}): Promise<Scanner3Rsi1hPipelineResult> {
  const scan = options?.skipScan
    ? ({ status: 'done' as const, rowCount: 0 })
    : await runScanner3Rsi1hScan('cron/run-scanner3-rsi-1h');

  if (scan.status === 'failed') {
    console.warn(
      `[Scanner3 RSI 1h] Scan falhou: ${scan.reason} — a tentar flip com último universo`
    );
  }

  try {
    await update24hResults();
  } catch (e) {
    console.warn('[Scanner3 RSI 1h] update24hResults:', e);
  }

  const flip = await runScanner3RsiFlip1hPipeline({
    force: options?.forceFlip,
    logPrefix: '[Universe-Scans → Scanner3 RSI Flip]',
  });

  try {
    await cleanupBybitOrphanOpenOrders();
  } catch {
    /* optional */
  }

  return { scan, flip };
}
