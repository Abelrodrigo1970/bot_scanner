/**
 * Scanners de universo: filtra perpétuos USDT por regra vs média móvel (SMA ou EMA).
 */

import { fetchCandles, fetchTopSymbolsByVolume, fetchTopPriceChange24hTickers, type Candle } from './marketData';
import {
  calculateADX,
  calculateATR,
  calculateDonchianRangePct,
  calculateLastEMA,
  calculateSMA,
  calculateRSI,
  getCloses,
} from './indicators';

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
  /** Lateral+volátil: período ADX. */
  adxPeriod?: number;
  /** Lateral+volátil: ADX máximo (sem tendência forte). */
  adxMax?: number;
  /** Lateral+volátil: período ATR. */
  atrPeriod?: number;
  /** Lateral+volátil: ATR% mínimo. */
  atrPctMin?: number;
  /** Lateral+volátil: comprimento Donchian. */
  donchianLength?: number;
  /** Lateral+volátil: amplitude Donchian máxima (%). */
  donchianPctMax?: number;
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
 * LATERAL_VOLATILE: ADX baixo + ATR% alto + Donchian apertado.
 * Persistência: ma = ADX, pctFromMa = ATR%.
 *
 * Nota: no Railway o fetchCandles usa Bybit — com muitos símbolos o rate-limit
 * silenciava falhas e o scan ficava incompleto. Aqui: batches pequenos, delay,
 * retries e 200 velas (como o script CLI).
 */
async function scanLateralVolatileUniverse(def: UniverseScanDefinition): Promise<UniverseScanRow[]> {
  const adxPeriod = Math.max(2, Math.floor(def.adxPeriod ?? 14));
  const adxMax = Number(def.adxMax ?? 20);
  const atrPeriod = Math.max(2, Math.floor(def.atrPeriod ?? 14));
  const atrPctMin = Number(def.atrPctMin ?? 1.5);
  const donchianLength = Math.max(2, Math.floor(def.donchianLength ?? 50));
  const donchianPctMax = Number(def.donchianPctMax ?? 12);
  const klineLimit = 200;
  const minClosed = Math.max(donchianLength, adxPeriod * 2 + 5, 80);

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
        // Última vela fechada (exclui formação) — alinhado aos outros scanners
        const closed = candles.slice(0, -1);
        if (closed.length < minClosed) {
          failed++;
          return null;
        }

        const adx = calculateADX(closed, adxPeriod);
        const atr = calculateATR(closed, atrPeriod);
        const close = closed[closed.length - 1]?.close;
        const donchPct = calculateDonchianRangePct(closed, donchianLength);
        if (adx == null || atr == null || !(close > 0) || donchPct == null) return null;

        const atrPct = (atr / close) * 100;
        if (!(adx < adxMax && atrPct >= atrPctMin && donchPct <= donchianPctMax)) return null;

        return { symbol, close, ma: adx, pctFromMa: atrPct };
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

  results.sort((a, b) => b.pctFromMa - a.pctFromMa);
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
