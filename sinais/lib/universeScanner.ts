/**
 * Scanners de universo: filtra perpétuos USDT por regra vs média móvel (SMA ou EMA).
 */

import { fetchCandles, fetchTopSymbolsByVolume, fetchTopPriceChange24hTickers, type Candle } from './marketData';
import {
  calculateEMA,
  calculateLastEMA,
  calculateSMA,
  calculateRSI,
  getCloses,
} from './indicators';
import { scanTopYtdMcapUniverse } from './ytdMcapUniverseScan';

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
  /** Scanners RSI: período do RSI (ruleType RSI_ABOVE / RSI_BELOW). */
  rsiPeriod?: number;
  /** Scanners RSI: limiar (mínimo em RSI_ABOVE, máximo em RSI_BELOW). */
  rsiThreshold?: number;
  /** Lateral: MA rápida (ex. 21). */
  maFastPeriod?: number;
  /** Lateral: MA lenta (ex. 70). */
  maSlowPeriod?: number;
  /** Lateral: |MA rápida−MA lenta|/MA lenta máx. (%). */
  maSpreadMaxPct?: number;
  /** Lateral: janela em dias (4h → bars = days*6). */
  lookbackDays?: number;
  /** YTD+mcap: market cap mínimo USD. */
  minMarketCapUsd?: number;
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

/** RSI_ABOVE / RSI_BELOW: perpétuos USDT vs limiar de RSI na última vela fechada. */
async function scanRsiThresholdUniverse(
  def: UniverseScanDefinition,
  mode: 'above' | 'below'
): Promise<UniverseScanRow[]> {
  const rsiPeriod = Math.max(2, Math.floor(def.rsiPeriod ?? 14));
  const threshold = Number(def.rsiThreshold ?? (mode === 'below' ? 32 : 75));
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
          if (mode === 'above' && rsi < threshold) return null;
          if (mode === 'below' && rsi >= threshold) return null;
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

  results.sort((a, b) => (mode === 'below' ? a.ma - b.ma : b.ma - a.ma));
  const limit = Math.floor(def.resultLimit ?? 0);
  return limit > 0 ? results.slice(0, limit) : results;
}

/**
 * LATERAL_VOLATILE (4h): |EMA21 − EMA70| / EMA70 < max% em todas as velas
 * dos últimos `lookbackDays` dias.
 * Persistência: ma = EMA21 actual, pctFromMa = spread % actual (menor = mais lateral).
 */
async function scanLateralVolatileUniverse(def: UniverseScanDefinition): Promise<UniverseScanRow[]> {
  const maFastPeriod = Math.max(2, Math.floor(def.maFastPeriod ?? 21));
  const maSlowPeriod = Math.max(maFastPeriod + 1, Math.floor(def.maSlowPeriod ?? 70));
  const maSpreadMaxPct = Number(def.maSpreadMaxPct ?? 10);
  const lookbackDays = Math.max(1, Math.floor(def.lookbackDays ?? 15));
  // 4h → 6 velas/dia
  const lookbackBars = lookbackDays * 6;
  const klineLimit = Math.min(500, Math.max(maSlowPeriod + lookbackBars + 20, 200));
  const minClosed = maSlowPeriod + lookbackBars;

  const symbols = await fetchTopSymbolsByVolume(
    Math.min(Math.max(def.candidateLimit, 50), 600),
    def.minQuoteVolume
  );
  const results: UniverseScanRow[] = [];
  let failed = 0;
  const LV_BATCH = 3;
  const LV_DELAY_MS = 280;

  async function fetchWithRetry(symbol: string): Promise<Candle[] | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const candles = await fetchCandles(symbol, def.timeframe, klineLimit);
        if (candles.length >= minClosed + 1) return candles;
        if (attempt < 2) await delay(200 * (attempt + 1));
      } catch {
        if (attempt < 2) await delay(350 * (attempt + 1));
      }
    }
    return null;
  }

  for (let i = 0; i < symbols.length; i += LV_BATCH) {
    const chunk = symbols.slice(i, i + LV_BATCH);
    const rows = await Promise.all(
      chunk.map(async (symbol): Promise<UniverseScanRow | null> => {
        const candles = await fetchWithRetry(symbol);
        if (!candles) {
          failed++;
          return null;
        }
        const closed = candles.slice(0, -1);
        if (closed.length < minClosed) {
          failed++;
          return null;
        }

        const closes = getCloses(closed);
        const emaFast = calculateEMA(closes, maFastPeriod);
        const emaSlow = calculateEMA(closes, maSlowPeriod);
        if (!emaFast?.length || !emaSlow?.length) return null;
        if (emaFast.length < lookbackBars || emaSlow.length < lookbackBars) return null;

        for (let k = 0; k < lookbackBars; k++) {
          const fast = emaFast[emaFast.length - 1 - k]!;
          const slow = emaSlow[emaSlow.length - 1 - k]!;
          if (!(slow > 0)) return null;
          const spread = (Math.abs(fast - slow) / slow) * 100;
          if (spread >= maSpreadMaxPct) return null;
        }

        const close = closes[closes.length - 1]!;
        const lastFast = emaFast[emaFast.length - 1]!;
        const lastSlow = emaSlow[emaSlow.length - 1]!;
        const lastSpread = (Math.abs(lastFast - lastSlow) / lastSlow) * 100;

        return { symbol, close, ma: lastFast, pctFromMa: lastSpread };
      })
    );
    for (const r of rows) {
      if (r) results.push(r);
    }
    await delay(LV_DELAY_MS);
  }

  if (failed > 0) {
    console.warn(
      `[LATERAL_VOLATILE] ${failed}/${symbols.length} símbolos sem klines (rate-limit/geo); matches=${results.length}`
    );
  }

  // Mais lateral primeiro (menor spread actual)
  results.sort((a, b) => a.pctFromMa - b.pctFromMa);
  const limit = Math.floor(def.resultLimit ?? 0);
  return limit > 0 ? results.slice(0, limit) : results;
}

export async function scanSymbolUniverse(
  def: UniverseScanDefinition
): Promise<UniverseScanRow[]> {
  if (def.ruleType === 'TOP_PRICE_CHANGE_24H') {
    return scanTopPriceChange24hUniverse(def);
  }
  if (def.ruleType === 'TOP_YTD_MCAP') {
    return scanTopYtdMcapUniverse({
      minMarketCapUsd: def.minMarketCapUsd,
      minQuoteVolume: def.minQuoteVolume,
      candidateLimit: def.candidateLimit,
      resultLimit: def.resultLimit,
    });
  }
  if (def.ruleType === 'RSI_ABOVE') {
    return scanRsiThresholdUniverse(def, 'above');
  }
  if (def.ruleType === 'RSI_BELOW') {
    return scanRsiThresholdUniverse(def, 'below');
  }
  if (def.ruleType === 'LATERAL_VOLATILE') {
    return scanLateralVolatileUniverse(def);
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
