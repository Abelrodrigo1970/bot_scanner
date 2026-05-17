/**
 * Scanners de universo: filtra perpétuos USDT por regra vs média móvel (SMA).
 */

import { fetchCandles, fetchTopSymbolsByVolume } from './marketData';
import { calculateSMA, getCloses } from './indicators';

export interface UniverseScanDefinition {
  ruleType: string;
  maPeriod: number;
  maxDistancePct: number | null;
  timeframe: string;
  minQuoteVolume: number;
  candidateLimit: number;
}

export interface UniverseScanRow {
  symbol: string;
  close: number;
  ma: number;
  pctFromMa: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BATCH = 6;
const BATCH_DELAY_MS = 120;

export async function scanSymbolUniverse(
  def: UniverseScanDefinition
): Promise<UniverseScanRow[]> {
  const symbols = await fetchTopSymbolsByVolume(
    Math.min(Math.max(def.candidateLimit, 50), 600),
    def.minQuoteVolume
  );
  const results: UniverseScanRow[] = [];

  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    const rows = await Promise.all(
      chunk.map(async (symbol): Promise<UniverseScanRow | null> => {
        try {
          const candles = await fetchCandles(symbol, def.timeframe, def.maPeriod + 10);
          if (candles.length < def.maPeriod) return null;
          const closes = getCloses(candles);
          const ma = calculateSMA(closes, def.maPeriod);
          const close = closes[closes.length - 1];
          if (ma === null || ma === 0) return null;
          const pctFromMa = ((close - ma) / ma) * 100;

          if (def.ruleType === 'ABOVE_MA') {
            if (close <= ma) return null;
            return { symbol, close, ma, pctFromMa };
          }
          if (def.ruleType === 'WITHIN_PCT_OF_MA') {
            const maxPct = def.maxDistancePct ?? 10;
            if (Math.abs(pctFromMa) > maxPct) return null;
            return { symbol, close, ma, pctFromMa };
          }
          return null;
        } catch {
          return null;
        }
      })
    );
    for (const r of rows) {
      if (r) results.push(r);
    }
    await delay(BATCH_DELAY_MS);
  }

  results.sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));
  return results;
}

export async function scanSymbolUniverseSymbols(
  def: UniverseScanDefinition
): Promise<string[]> {
  const rows = await scanSymbolUniverse(def);
  return rows.map((r) => r.symbol);
}
