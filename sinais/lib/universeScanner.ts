/**
 * Scanners de universo: filtra perpétuos USDT por regra vs média móvel (SMA ou EMA).
 */

import { fetchCandles, fetchTopSymbolsByVolume, fetchTopPriceChange24hTickers } from './marketData';
import { calculateLastEMA, calculateSMA, calculateRSI, getCloses } from './indicators';

export interface UniverseScanDefinition {
  ruleType: string;
  maPeriod: number;
  /** SMA (defeito) ou EMA — alinhar com a estratégia que usa o scan. */
  maType?: 'SMA' | 'EMA';
  /** Mínimo % vs MA: ABOVE_MA = mín. acima; WITHIN_PCT_OF_MA = limite inferior (ex. -5). */
  minDistancePct?: number | null;
  maxDistancePct: number | null;
  timeframe: string;
  minQuoteVolume: number;
  candidateLimit: number;
  /** Máximo de linhas gravadas (ex.: top 30 volume 24h). */
  resultLimit?: number;
  /** Scanners RSI: período do RSI (ruleType RSI_ABOVE). */
  rsiPeriod?: number;
  /** Scanners RSI: limiar mínimo de RSI a incluir (ex.: 75). */
  rsiThreshold?: number;
}

function maAtClose(closes: number[], def: UniverseScanDefinition): number | null {
  const useEma = def.maType === 'EMA';
  return useEma ? calculateLastEMA(closes, def.maPeriod) : calculateSMA(closes, def.maPeriod);
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

async function scanTopPriceChange24hUniverse(def: UniverseScanDefinition): Promise<UniverseScanRow[]> {
  const limit = Math.max(1, Math.floor(def.resultLimit ?? def.candidateLimit ?? 30));
  const tickers = await fetchTopPriceChange24hTickers(limit, def.minQuoteVolume);
  return tickers.map((t) => ({
    symbol: t.symbol,
    close: t.lastPrice,
    ma: t.quoteVolume,
    pctFromMa: t.priceChangePercent,
  }));
}

/** RSI_ABOVE: perpétuos USDT com RSI (timeframe def) acima do limiar, ordenados por RSI desc. */
async function scanRsiAboveUniverse(def: UniverseScanDefinition): Promise<UniverseScanRow[]> {
  const rsiPeriod = Math.max(2, Math.floor(def.rsiPeriod ?? 14));
  const threshold = Number(def.rsiThreshold ?? 75);
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
          const candles = await fetchCandles(symbol, def.timeframe, rsiPeriod + 80);
          if (candles.length < rsiPeriod + 2) return null;
          // Exclui a vela em formação — RSI da última vela fechada.
          const closed = candles.slice(0, -1);
          const closes = getCloses(closed);
          const rsi = calculateRSI(closes, rsiPeriod);
          const close = closes[closes.length - 1];
          if (rsi === null || close === undefined) return null;
          if (rsi < threshold) return null;
          return { symbol, close, ma: rsi, pctFromMa: rsi };
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

  results.sort((a, b) => b.ma - a.ma);
  const limit = Math.floor(def.resultLimit ?? 0);
  return limit > 0 ? results.slice(0, limit) : results;
}

export async function scanSymbolUniverse(
  def: UniverseScanDefinition
): Promise<UniverseScanRow[]> {
  if (def.ruleType === 'TOP_PRICE_CHANGE_24H') {
    return scanTopPriceChange24hUniverse(def);
  }
  if (def.ruleType === 'RSI_ABOVE') {
    return scanRsiAboveUniverse(def);
  }

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
          const ma = maAtClose(closes, def);
          const close = closes[closes.length - 1];
          if (ma === null || ma === 0) return null;
          const pctFromMa = ((close - ma) / ma) * 100;

          if (def.ruleType === 'ABOVE_MA') {
            if (close < ma) return null;
            if (def.minDistancePct != null && pctFromMa < def.minDistancePct) return null;
            if (def.maxDistancePct != null && pctFromMa > def.maxDistancePct) return null;
            return { symbol, close, ma, pctFromMa };
          }
          if (def.ruleType === 'WITHIN_PCT_OF_MA') {
            const maxPct = def.maxDistancePct ?? 10;
            if (def.minDistancePct != null) {
              if (pctFromMa < def.minDistancePct || pctFromMa > maxPct) return null;
            } else if (Math.abs(pctFromMa) > maxPct) {
              return null;
            }
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
