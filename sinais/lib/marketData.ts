/**
 * Funções para buscar dados de mercado de APIs públicas
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

/** Atraso em ms (evitar rate limit da Binance) */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Modo backtest: injecta histórico local em vez de pedir à Binance. */
type BacktestCandleState = {
  pools: Map<string, Candle[]>;
  endMs: number;
};

let backtestCandleState: BacktestCandleState | null = null;

export function setBacktestCandlePools(pools: Map<string, Candle[]>): void {
  backtestCandleState = { pools, endMs: Number.POSITIVE_INFINITY };
}

export function setBacktestCursor(endMs: number): void {
  if (backtestCandleState) backtestCandleState.endMs = endMs;
}

export function clearBacktestCandlePools(): void {
  backtestCandleState = null;
}

const BINANCE_FAPI_HOSTS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
  'https://fapi3.binance.com',
] as const;

const BINANCE_FAPI_RETRYABLE_STATUSES = new Set([418, 429, 451, 500, 502, 503, 504]);
const BYBIT_API_BASE = 'https://api.bybit.com';
/** Intervalos Binance → Bybit linear kline (v5). */
const BYBIT_KLINE_INTERVAL: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
};
/** Espaço mínimo entre pedidos klines (cron analisa muitos símbolos em sequência). */
const BINANCE_KLINES_MIN_GAP_MS = 120;
let lastBinanceKlinesFetchAt = 0;

const BINANCE_PUBLIC_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; bot_cripto-cron/1.0; +https://github.com/Abelrodrigo1970/bot_cripto)',
};

const BINANCE_KLINES_TIMEOUT_MS = 25_000;

async function throttleBinanceKlinesFetch(): Promise<void> {
  const now = Date.now();
  const waitMs = lastBinanceKlinesFetchAt + BINANCE_KLINES_MIN_GAP_MS - now;
  if (waitMs > 0) await delay(waitMs);
  lastBinanceKlinesFetchAt = Date.now();
}

function isRetryableKlinesError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { retryable?: boolean; status?: number; name?: string };
  if (e.retryable === true) return true;
  if (e.status != null && BINANCE_FAPI_RETRYABLE_STATUSES.has(e.status)) return true;
  if (e.name === 'SyntaxError') return true;
  if (e.name === 'TypeError') return true;
  if (e.name === 'AbortError') return true;
  return false;
}

function parseBinanceKlinesBody(text: string, symbol: string, host: string): Candle[] {
  const trimmed = text.trim();
  if (!trimmed) {
    const err: Error & { retryable?: boolean } = new Error(
      `Resposta vazia da Binance klines (${symbol} @ ${host})`
    );
    err.retryable = true;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const err: Error & { retryable?: boolean } = new Error(
      `JSON inválido da Binance klines (${symbol} @ ${host})`
    );
    err.retryable = true;
    throw err;
  }

  if (!Array.isArray(parsed)) {
    const api = parsed as { code?: number; msg?: string };
    const msg = api?.msg ?? trimmed.slice(0, 160);
    const err: Error & { retryable?: boolean; status?: number } = new Error(
      `Binance klines erro (${symbol}): ${msg}`
    );
    err.retryable =
      api?.code === -1003 ||
      api?.code === -1006 ||
      api?.code === -1007 ||
      api?.code === 418;
    if (api?.code === 418) err.status = 418;
    throw err;
  }

  return parsed.map((candle: unknown) => {
    const c = candle as (string | number)[];
    return {
      open: parseFloat(String(c[1])),
      high: parseFloat(String(c[2])),
      low: parseFloat(String(c[3])),
      close: parseFloat(String(c[4])),
      volume: parseFloat(String(c[5])),
      timestamp: Number(c[0]),
    };
  });
}

function parseBybitKlineRows(rows: string[][]): Candle[] {
  return rows
    .map((row) => ({
      timestamp: Number(row[0]),
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[5]),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.timestamp) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Fallback quando Binance Futures bloqueia o IP (HTTP 451 no Railway US). */
async function fetchCandlesFromBybit(
  symbol: string,
  interval: string,
  limit: number,
  startTime?: number,
  endTime?: number
): Promise<Candle[]> {
  const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
  if (!bybitInterval) {
    throw new Error(`Intervalo ${interval} sem equivalente Bybit`);
  }

  const url = new URL(`${BYBIT_API_BASE}/v5/market/kline`);
  url.searchParams.set('category', 'linear');
  url.searchParams.set('symbol', symbol.toUpperCase());
  url.searchParams.set('interval', bybitInterval);
  url.searchParams.set('limit', String(Math.min(Math.max(1, limit), 1000)));
  if (startTime) url.searchParams.set('start', String(startTime));
  if (endTime) url.searchParams.set('end', String(endTime));

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    headers: BINANCE_PUBLIC_HEADERS,
    signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
  });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Bybit klines ${symbol}: ${response.status} ${response.statusText} — ${bodyText.slice(0, 120)}`
    );
  }

  const parsed = JSON.parse(bodyText.trim()) as { result?: { list?: string[][] } };
  const rows = parsed.result?.list ?? [];
  if (rows.length === 0) {
    throw new Error(`Bybit klines vazio para ${symbol}`);
  }

  let candles = parseBybitKlineRows(rows);
  if (startTime) candles = candles.filter((c) => c.timestamp >= startTime);
  if (endTime) candles = candles.filter((c) => c.timestamp <= endTime);
  if (candles.length > limit) candles = candles.slice(-limit);
  return candles;
}

async function fetchCurrentPriceFromBybit(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  const url = `${BYBIT_API_BASE}/v5/market/tickers?category=linear&symbol=${sym}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: BINANCE_PUBLIC_HEADERS,
    signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
  });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Bybit ticker ${sym}: ${response.status} ${response.statusText}`);
  }

  const parsed = JSON.parse(bodyText.trim()) as {
    result?: { list?: Array<{ lastPrice?: string }> };
  };
  const price = parseFloat(parsed.result?.list?.[0]?.lastPrice ?? '');
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Preço Bybit inválido para ${sym}`);
  }
  return price;
}

function shouldFallbackToBybit(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const status = (err as { status?: number }).status;
  return status == null || status === 451 || status >= 500;
}

/**
 * Busca velas (candles) de uma exchange pública (Binance Futures USDⓈ-M)
 */
export async function fetchCandles(
  symbol: string,
  interval: string,
  limit: number = 200,
  startTime?: number,
  endTime?: number
): Promise<Candle[]> {
  if (backtestCandleState) {
    const key = `${symbol.toUpperCase()}:${interval}`;
    const all = backtestCandleState.pools.get(key) ?? [];
    let filtered = all.filter((c) => c.timestamp <= backtestCandleState!.endMs);
    if (startTime) filtered = filtered.filter((c) => c.timestamp >= startTime);
    if (endTime) filtered = filtered.filter((c) => c.timestamp <= endTime);
    return filtered.slice(-Math.max(1, limit));
  }

  const hostCount = BINANCE_FAPI_HOSTS.length;
  /** Várias voltas aos mirrors (timeouts / corpo truncado / rate limit). */
  const maxAttempts = hostCount * 3;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const host = BINANCE_FAPI_HOSTS[attempt % hostCount];
    const url = new URL('/fapi/v1/klines', host);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(limit));
    if (startTime) url.searchParams.set('startTime', String(startTime));
    if (endTime) url.searchParams.set('endTime', String(endTime));

    try {
      await throttleBinanceKlinesFetch();
      const response = await fetch(url.toString(), {
        cache: 'no-store',
        headers: BINANCE_PUBLIC_HEADERS,
        signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
      });
      const bodyText = await response.text();

      if (!response.ok) {
        const error: Error & { status?: number; endpoint?: string } = new Error(
          `Erro ao buscar dados: ${response.status} ${response.statusText}`
        );
        error.status = response.status;
        error.endpoint = host;
        if (!BINANCE_FAPI_RETRYABLE_STATUSES.has(response.status)) {
          throw error;
        }
        lastError = error;
        if (attempt < maxAttempts - 1) {
          await delay(400 * (attempt + 1));
        }
        continue;
      }

      return parseBinanceKlinesBody(bodyText, symbol, host);
    } catch (err) {
      lastError = err;
      if (!isRetryableKlinesError(err) || attempt === maxAttempts - 1) {
        break;
      }
      await delay(400 * (attempt + 1));
    }
  }

  if (shouldFallbackToBybit(lastError) && BYBIT_KLINE_INTERVAL[interval]) {
    try {
      const status = (lastError as { status?: number })?.status;
      console.warn(
        `⚠️ Binance candles ${symbol} falhou${status ? ` (${status})` : ''}; a usar Bybit (${interval})`
      );
      return await fetchCandlesFromBybit(symbol, interval, limit, startTime, endTime);
    } catch (bybitErr) {
      console.error(`Erro ao buscar candles para ${symbol} (Binance + Bybit):`, bybitErr);
      throw bybitErr;
    }
  }

  console.error(`Erro ao buscar candles para ${symbol}:`, lastError);
  throw lastError;
}

/**
 * Busca o preço actual de um par (Futures USDⓈ-M). Usa mirrors Binance como fetchCandles.
 */
export async function fetchCurrentPrice(symbol: string): Promise<number> {
  const hostCount = BINANCE_FAPI_HOSTS.length;
  const maxAttempts = hostCount * 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const host = BINANCE_FAPI_HOSTS[attempt % hostCount];
    const url = `${host}/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`;

    try {
      await throttleBinanceKlinesFetch();
      const response = await fetch(url, {
        cache: 'no-store',
        headers: BINANCE_PUBLIC_HEADERS,
        signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
      });
      const bodyText = await response.text();

      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`.trim();
        try {
          const api = JSON.parse(bodyText.trim()) as { msg?: string; code?: number };
          if (api?.msg) detail = `${detail} — ${api.msg}`;
        } catch {
          if (bodyText.trim()) detail += ` — ${bodyText.trim().slice(0, 120)}`;
        }
        const error: Error & { status?: number } = new Error(
          `Erro ao buscar preço ${symbol}: ${detail}`
        );
        error.status = response.status;
        if (!BINANCE_FAPI_RETRYABLE_STATUSES.has(response.status)) {
          throw error;
        }
        lastError = error;
        await delay(400 * (attempt + 1));
        continue;
      }

      const trimmed = bodyText.trim();
      if (!trimmed) {
        lastError = new Error(`Resposta vazia da Binance (preço ${symbol})`);
        await delay(400 * (attempt + 1));
        continue;
      }

      const data = JSON.parse(trimmed) as { price?: string };
      const price = parseFloat(data.price ?? '');
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Preço inválido para ${symbol}`);
      }
      return price;
    } catch (err) {
      lastError = err;
      if (!isRetryableKlinesError(err) || attempt === maxAttempts - 1) {
        break;
      }
      await delay(400 * (attempt + 1));
    }
  }

  if (shouldFallbackToBybit(lastError)) {
    try {
      const status = (lastError as { status?: number })?.status;
      console.warn(
        `⚠️ Binance preço ${symbol} falhou${status ? ` (${status})` : ''}; a usar Bybit`
      );
      return await fetchCurrentPriceFromBybit(symbol);
    } catch (bybitErr) {
      throw bybitErr instanceof Error ? bybitErr : new Error(`Erro ao buscar preço ${symbol}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Erro ao buscar preço ${symbol}`);
}

/** Como {@link fetchCurrentPrice}, mas devolve null em falha (sem log). */
export async function fetchCurrentPriceSafe(symbol: string): Promise<number | null> {
  try {
    return await fetchCurrentPrice(symbol);
  } catch {
    return null;
  }
}

/** Preço de fallback: último close 1h ou preço de entrada. */
export async function fetchFallbackPrice(
  symbol: string,
  entryPrice: number
): Promise<{ price: number; source: 'ticker' | 'klines' | 'entry' }> {
  const ticker = await fetchCurrentPriceSafe(symbol);
  if (ticker != null) return { price: ticker, source: 'ticker' };

  try {
    const candles = await fetchCandles(symbol, '1h', 3);
    const last = candles[candles.length - 1];
    if (last && last.close > 0) {
      return { price: last.close, source: 'klines' };
    }
  } catch {
    // ignora — usa entrada
  }

  return { price: entryPrice, source: 'entry' };
}

/** Turnover USDT da última vela 1h fechada (Binance Futures). Proxy de liquidez/market cap. */
export async function fetchLastClosed1hQuoteVolumeUsd(symbol: string): Promise<number | null> {
  const sym = symbol.toUpperCase();
  for (const host of BINANCE_FAPI_HOSTS) {
    try {
      await throttleBinanceKlinesFetch();
      const response = await fetch(
        `${host}/fapi/v1/klines?symbol=${sym}&interval=1h&limit=2`,
        {
          cache: 'no-store',
          headers: BINANCE_PUBLIC_HEADERS,
          signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
        }
      );
      if (!response.ok) continue;
      const rows = (await response.json()) as unknown[][];
      if (rows.length < 1) return null;
      const lastClosed = rows.length >= 2 ? rows[rows.length - 2]! : rows[rows.length - 1]!;
      const quoteVol = parseFloat(String(lastClosed[7] ?? ''));
      return Number.isFinite(quoteVol) && quoteVol > 0 ? quoteVol : null;
    } catch {
      continue;
    }
  }

  try {
    const url = `${BYBIT_API_BASE}/v5/market/kline?category=linear&symbol=${sym}&interval=60&limit=2`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: BINANCE_PUBLIC_HEADERS,
      signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { result?: { list?: string[][] } };
    const rows = parsed.result?.list ?? [];
    const row = rows.length >= 2 ? rows[1]! : rows[0];
    const turnover = parseFloat(row?.[6] ?? '');
    return Number.isFinite(turnover) && turnover > 0 ? turnover : null;
  } catch {
    return null;
  }
}

/**
 * Lista de símbolos padrão para análise
 */
export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'];

/**
 * Intervalos de tempo suportados
 */
export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

/** Remove a última vela se ainda estiver em formação (evita falsos cruzamentos intrabar). */
export function dropFormingCandle(candles: Candle[], timeframe: Timeframe): Candle[] {
  if (candles.length === 0) return candles;
  const durationMs = TIMEFRAME_DURATION_MS[timeframe];
  const last = candles[candles.length - 1]!;
  if (last.timestamp + durationMs > Date.now()) {
    return candles.slice(0, -1);
  }
  return candles;
}

/**
 * Interface para dados de Top Movers
 */
export interface TopMover {
  symbol: string;
  priceChangePercent: number;
  lastPrice: number;
  volume: number;
  highPrice: number;
  lowPrice: number;
}

/**
 * Busca os Top Movers (maiores ganhadores) da Binance Futures USDⓈ-M
 * Calcula a variação percentual desde o início do dia atual (00:00 UTC)
 * Filtra apenas pares USDⓈ-M e ordena por variação percentual decrescente
 * @param limit Número máximo de resultados (padrão: 15)
 */
export async function fetchTopMovers(limit: number = 15): Promise<TopMover[]> {
  try {
    // Buscar todos os tickers 24h para obter lista de símbolos e preços atuais
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');

    if (!response.ok) {
      throw new Error(`Erro ao buscar dados: ${response.statusText}`);
    }

    const data = await response.json();

    // Filtrar apenas pares USDⓈ-M (Futuros com margem em USDT) com volume mínimo
    // Ordenar por volume para priorizar os mais líquidos
    const usdtPairs = data
      .filter((ticker: any) => {
        return ticker.symbol.endsWith('USDT') && 
               !ticker.symbol.includes('BUSD') &&
               parseFloat(ticker.quoteVolume) > 1000000; // Volume mínimo de 1M USDT
      })
      .sort((a: any, b: any) => {
        return parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume);
      })
      .slice(0, 50); // Limitar a 50 símbolos mais líquidos para otimizar

    // Buscar candles diários para obter preço de abertura do dia atual
    // Usar Promise.all com limite de concorrência para não sobrecarregar a API
    const topMoversData = await Promise.all(
      usdtPairs.map(async (ticker: any) => {
        try {
          // Buscar candles diários (apenas o último candle que contém o dia atual)
          const candlesResponse = await fetch(
            `https://fapi.binance.com/fapi/v1/klines?symbol=${ticker.symbol}&interval=1d&limit=1`
          );
          
          if (!candlesResponse.ok) {
            return null;
          }

          const candles = await candlesResponse.json();
          
          if (candles.length === 0) {
            return null;
          }

          // O último candle é o do dia atual
          const todayCandle = candles[candles.length - 1];
          const openPrice = parseFloat(todayCandle[1]); // Preço de abertura
          const currentPrice = parseFloat(ticker.lastPrice);
          const highPrice = parseFloat(todayCandle[2]); // Máxima do dia
          const lowPrice = parseFloat(todayCandle[3]); // Mínima do dia
          
          // Calcular variação percentual do dia atual
          const priceChangePercent = ((currentPrice - openPrice) / openPrice) * 100;

          return {
            symbol: ticker.symbol,
            priceChangePercent,
            lastPrice: currentPrice,
            volume: parseFloat(ticker.volume),
            highPrice,
            lowPrice,
          };
        } catch (error) {
          console.error(`Erro ao buscar dados para ${ticker.symbol}:`, error);
          return null;
        }
      })
    );

    // Filtrar nulos e apenas ganhadores (variação positiva)
    const validMovers = topMoversData
      .filter((mover): mover is NonNullable<typeof mover> => 
        mover !== null && mover.priceChangePercent > 0
      );

    // Ordenar por priceChangePercent decrescente
    const sorted = validMovers.sort((a, b) => {
      return b.priceChangePercent - a.priceChangePercent;
    });

    // Retornar os top N
    return sorted.slice(0, limit);
  } catch (error) {
    console.error('Erro ao buscar Top Movers:', error);
    throw error;
  }
}

/**
 * Busca os top N símbolos USDT perpetual por quoteVolume 24h
 * @param limit Número máximo de símbolos (padrão: 50)
 * @param minQuoteVolume Volume mínimo em USDT (padrão: 0, sem filtro)
 */
export async function fetchTopSymbolsByVolume(
  limit: number = 50,
  minQuoteVolume: number = 0
): Promise<string[]> {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');

    if (!response.ok) {
      throw new Error(`Erro ao buscar dados: ${response.statusText}`);
    }

    const data = await response.json();

    // Filtrar apenas pares USDT perpetual
    const usdtPairs = data
      .filter((ticker: any) => {
        return (
          ticker.symbol.endsWith('USDT') &&
          !ticker.symbol.includes('BUSD') &&
          parseFloat(ticker.quoteVolume) >= minQuoteVolume
        );
      })
      .map((ticker: any) => ({
        symbol: ticker.symbol,
        quoteVolume: parseFloat(ticker.quoteVolume),
      }));

    // Ordenar por quoteVolume decrescente
    const sorted = usdtPairs.sort((a: any, b: any) => {
      return b.quoteVolume - a.quoteVolume;
    });

    // Retornar apenas os símbolos
    return sorted.slice(0, limit).map((item: any) => item.symbol);
  } catch (error) {
    console.error('Erro ao buscar top símbolos por volume:', error);
    throw error;
  }
}

/**
 * Busca os top N símbolos USDT perpetual por variação percentual de preço 24h
 * Ordena por priceChangePercent (maior subida primeiro)
 * @param limit Número máximo de símbolos (padrão: 50)
 * @param minQuoteVolume Volume mínimo em USDT para filtrar pares mortos (padrão: 0)
 */
export async function fetchTopSymbolsBy24hPriceChange(
  limit: number = 50,
  minQuoteVolume: number = 0
): Promise<string[]> {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');

    if (!response.ok) {
      throw new Error(`Erro ao buscar dados: ${response.statusText}`);
    }

    const data = await response.json();

    const usdtPairs = data
      .filter((ticker: any) => {
        return (
          ticker.symbol.endsWith('USDT') &&
          !ticker.symbol.includes('BUSD') &&
          parseFloat(ticker.quoteVolume) >= minQuoteVolume
        );
      })
      .map((ticker: any) => ({
        symbol: ticker.symbol,
        priceChangePercent: parseFloat(ticker.priceChangePercent || '0'),
      }));

    // Ordenar por priceChangePercent decrescente (maior subida primeiro)
    const sorted = usdtPairs.sort((a: any, b: any) => {
      return b.priceChangePercent - a.priceChangePercent;
    });

    return sorted.slice(0, limit).map((item: any) => item.symbol);
  } catch (error) {
    console.error('Erro ao buscar top símbolos por % 24h:', error);
    throw error;
  }
}

/**
 * Busca os símbolos com maior variação de preço na última hora (1h).
 * Não usa volume 24h: lista de candidatos vem do exchangeInfo (Binance Futures).
 * Ordena apenas por % de variação na última hora.
 * @param limit Número máximo de símbolos (padrão: 150)
 * @param candidatePool Quantos símbolos consultar (klines 1h) antes de ordenar (padrão: 250)
 */
export async function fetchTopSymbolsBy1hPriceChange(
  limit: number = 150,
  candidatePool: number = 250
): Promise<string[]> {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    if (!response.ok) {
      throw new Error(`Erro ao buscar exchangeInfo: ${response.statusText}`);
    }
    const data = await response.json();

    const usdtPairs: string[] = (data.symbols || [])
      .filter((s: any) => {
        return (
          s.symbol?.endsWith('USDT') &&
          !s.symbol?.includes('BUSD') &&
          s.status === 'TRADING' &&
          (s.contractType === 'PERPETUAL' || !s.contractType)
        );
      })
      .slice(0, candidatePool)
      .map((s: any) => s.symbol);

    const results: { symbol: string; changePercent1h: number }[] = [];

    for (let i = 0; i < usdtPairs.length; i++) {
      const symbol = usdtPairs[i];
      try {
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=2`
        );
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        if (klines.length < 2) continue;
        const prevClose = parseFloat(klines[0][4]);
        const lastClose = parseFloat(klines[1][4]);
        if (prevClose === 0) continue;
        const changePercent1h = ((lastClose - prevClose) / prevClose) * 100;
        results.push({ symbol, changePercent1h });
      } catch {
        // ignorar falha por símbolo
      }
      if ((i + 1) % 50 === 0) await delay(100);
      else await delay(80);
    }    results.sort((a, b) => b.changePercent1h - a.changePercent1h);
    return results.slice(0, limit).map((r) => r.symbol);
  } catch (error) {
    console.error('Erro ao buscar símbolos por variação 1h:', error);
    throw error;
  }
}

export interface TopVolatileItem {
  symbol: string;
  /** Máxima na janela de scan (~2 meses); nome de campo histórico. */
  high3m: number;
  /** Mínima na janela de scan (~2 meses); nome de campo histórico. */
  low3m: number;
  volatilityPercent: number;
  lastPrice: number;
  rank: number;
}

/** Início da janela de klines diários para Top Voláteis (~60 dias ≈ 2 meses). */
export const TOP_VOLATILE_SCAN_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Busca as top 25 criptos mais voláteis dos últimos ~2 meses.
 * Volatilidade = (max - min) / min * 100 sobre candles diários.
 * Usa o maior número possível de pares USDT com volume mínimo.
 */
export interface MaCrossBelowItem {
  symbol: string;
  lastPrice: number;
  ma30: number;
  ma200: number;
  distPriceMa200: number; // % abaixo da MA200 (negativo)
  distMa30Ma200: number;  // % MA30 acima de MA200 (positivo)
  rank: number;
}

/**
 * Scan de criptos onde a MA30 está próxima de cruzar a MA200 (timeframe 1h).
 * Distância entre -3% e +3% da MA200 — cruzamento iminente.
 * Ordenado pela menor distância absoluta (mais próximos de cruzar).
 */
export async function fetchMaCrossBelow(limit: number = 100): Promise<MaCrossBelowItem[]> {
  try {
    const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!tickerRes.ok) throw new Error('Erro ao buscar tickers');
    const tickerData = await tickerRes.json();

    // Top 300 por volume, só USDT futures
    const symbols: string[] = tickerData
      .filter((t: any) => t.symbol?.endsWith('USDT') && !t.symbol?.includes('BUSD') && parseFloat(t.quoteVolume || '0') > 500000)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300)
      .map((t: any) => t.symbol);

    const results: Omit<MaCrossBelowItem, 'rank'>[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        // Buscar 205 velas de 1h — 205h ≈ 8,5 dias, suficiente para MA200 1h
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=205`
        );
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        if (klines.length < 202) continue;

        // Closes excluindo a vela em formação (último candle ainda não fechado)
        const closes: number[] = klines.slice(0, -1).map((k: any) => parseFloat(k[4]));
        const lastPrice = closes[closes.length - 1];

        // MA200 e MA30 sobre candles fechados
        const ma200Vals = closes.slice(-200);
        const ma30Vals  = closes.slice(-30);

        if (ma200Vals.length < 200 || ma30Vals.length < 30) continue;

        const ma200 = ma200Vals.reduce((s, v) => s + v, 0) / 200;
        const ma30  = ma30Vals.reduce((s, v) => s + v, 0) / 30;

        // Condição: MA30 a uma distância entre -3% e +3% da MA200
        const distMa30Ma200  = ((ma30 - ma200) / ma200) * 100;
        if (distMa30Ma200 < -3 || distMa30Ma200 > 3) continue;

        const distPriceMa200 = ((lastPrice - ma200) / ma200) * 100;

        results.push({ symbol, lastPrice, ma30, ma200, distPriceMa200, distMa30Ma200 });
      } catch {
        // ignorar falha por símbolo
      }
      await delay(i % 5 === 4 ? 150 : 80);
    }

    // Ordenar: menor distância absoluta primeiro (mais próximos de cruzar)
    results.sort((a, b) => Math.abs(a.distMa30Ma200) - Math.abs(b.distMa30Ma200));

    return results.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  } catch (error) {
    console.error('Erro ao buscar MA Cross Below:', error);
    throw error;
  }
}

/**
 * Scan de criptos na Binance Futures (top 300 por volume) com MA30 a **mais de 9%** acima
 * da MA200 (timeframe 1h). Indica força de tendência — MA30 já alargada em relação à MA200.
 * Ordenado por distância decrescente (maior distância primeiro).
 */
export async function fetchMa30Above6Pct(limit: number = 100): Promise<MaCrossBelowItem[]> {
  try {
    const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!tickerRes.ok) throw new Error('Erro ao buscar tickers');
    const tickerData = await tickerRes.json();

    const symbols: string[] = tickerData
      .filter((t: any) => t.symbol?.endsWith('USDT') && !t.symbol?.includes('BUSD') && parseFloat(t.quoteVolume || '0') > 500000)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300)
      .map((t: any) => t.symbol);

    const results: Omit<MaCrossBelowItem, 'rank'>[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=205`
        );
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        if (klines.length < 202) continue;

        const closes: number[] = klines.slice(0, -1).map((k: any) => parseFloat(k[4]));
        const lastPrice = closes[closes.length - 1];

        const ma200Vals = closes.slice(-200);
        const ma30Vals = closes.slice(-30);

        if (ma200Vals.length < 200 || ma30Vals.length < 30) continue;

        const ma200 = ma200Vals.reduce((s, v) => s + v, 0) / 200;
        const ma30 = ma30Vals.reduce((s, v) => s + v, 0) / 30;

        const distMa30Ma200 = ((ma30 - ma200) / ma200) * 100;
        if (distMa30Ma200 <= 9) continue;

        const distPriceMa200 = ((lastPrice - ma200) / ma200) * 100;

        results.push({ symbol, lastPrice, ma30, ma200, distPriceMa200, distMa30Ma200 });
      } catch {
        // ignorar
      }
      await delay(i % 5 === 4 ? 150 : 80);
    }

    results.sort((a, b) => b.distMa30Ma200 - a.distMa30Ma200);

    return results.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  } catch (error) {
    console.error('Erro ao buscar MA30 > 9% acima da MA200:', error);
    throw error;
  }
}

/** Faixa em % (inclusive): **−6** ≤ (MA30−MA200)/MA200×100 ≤ **+1**. */
const MA30_VS_MA200_BAND_LOW_PCT = -6;
const MA30_VS_MA200_BAND_HIGH_PCT = 1;

/**
 * Scan: MA30 vs MA200 em 1h (SMA), distância relativa na **faixa −6% … +1%** (inclusive).
 * Top 300 por volume Binance Futures.
 * Ordenado por distância **decrescente** (+1% primeiro, depois até −6%).
 */
export async function fetchMa30Near6PriceBetween(limit: number = 300): Promise<MaCrossBelowItem[]> {
  try {
    const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!tickerRes.ok) throw new Error('Erro ao buscar tickers');
    const tickerData = await tickerRes.json();

    const symbols: string[] = tickerData
      .filter((t: any) => t.symbol?.endsWith('USDT') && !t.symbol?.includes('BUSD') && parseFloat(t.quoteVolume || '0') > 500000)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300)
      .map((t: any) => t.symbol);

    const results: Omit<MaCrossBelowItem, 'rank'>[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=205`
        );
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        if (klines.length < 202) continue;

        const closes: number[] = klines.slice(0, -1).map((k: any) => parseFloat(k[4]));
        const lastPrice = closes[closes.length - 1];

        const ma200Vals = closes.slice(-200);
        const ma30Vals = closes.slice(-30);
        if (ma200Vals.length < 200 || ma30Vals.length < 30) continue;

        const ma200 = ma200Vals.reduce((s, v) => s + v, 0) / 200;
        const ma30 = ma30Vals.reduce((s, v) => s + v, 0) / 30;
        if (ma200 <= 0) continue;

        const distMa30Ma200 = ((ma30 - ma200) / ma200) * 100;
        if (distMa30Ma200 < MA30_VS_MA200_BAND_LOW_PCT || distMa30Ma200 > MA30_VS_MA200_BAND_HIGH_PCT) {
          continue;
        }

        const distPriceMa200 = ((lastPrice - ma200) / ma200) * 100;

        results.push({ symbol, lastPrice, ma30, ma200, distPriceMa200, distMa30Ma200 });
      } catch {
        // ignorar
      }
      await delay(i % 5 === 4 ? 150 : 80);
    }

    results.sort((a, b) => b.distMa30Ma200 - a.distMa30Ma200);

    return results.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  } catch (error) {
    console.error('Erro ao buscar MA30 −6%…+1% vs MA200 (1h):', error);
    throw error;
  }
}

export interface BybitAboveMa200Mc20mItem {
  symbol: string;
  baseAsset: string;
  marketCap: number;
  lastPrice: number;
  ma200: number;
  distPriceMa200: number;
  rank: number;
}

/**
 * Scan Bybit (USDT Perpetual):
 * - apenas símbolos listados/trading na Bybit
 * - turnover 1h (vela fechada) >= minTurnover1hUsd
 * - preço (close 1h fechado) acima da MA200 (1h)
 */
export async function fetchBybitAboveMa200Mc20m(
  limit: number = 300,
  minTurnover1hUsd: number = 500_000
): Promise<BybitAboveMa200Mc20mItem[]> {
  type BybitInstrument = {
    symbol?: string;
    status?: string;
    quoteCoin?: string;
  };
  const bybitSymbolsRes = await fetch(
    'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'
  );
  if (!bybitSymbolsRes.ok) {
    throw new Error(`Erro ao buscar instrumentos Bybit: ${bybitSymbolsRes.statusText}`);
  }

  const bybitSymbolsJson = await bybitSymbolsRes.json();
  const bybitList: BybitInstrument[] = bybitSymbolsJson?.result?.list ?? [];
  const bybitUsdtSymbols = bybitList
    .filter((item) => item.status === 'Trading' && item.quoteCoin === 'USDT' && item.symbol?.endsWith('USDT'))
    .map((item) => String(item.symbol));

  if (bybitUsdtSymbols.length === 0) return [];

  const results: Omit<BybitAboveMa200Mc20mItem, 'rank'>[] = [];
  for (let i = 0; i < bybitUsdtSymbols.length; i++) {
    const symbol = bybitUsdtSymbols[i];
    const baseAsset = symbol.replace(/USDT$/, '');
    try {
      const klineRes = await fetch(
        `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=210`
      );
      if (!klineRes.ok) continue;
      const klineJson = await klineRes.json();
      const rawList: string[][] = klineJson?.result?.list ?? [];
      if (rawList.length < 202) continue;

      // Bybit retorna mais recente -> mais antigo; inverter para ordem temporal.
      const ascending = rawList.slice().reverse();
      const closes = ascending.map((k) => parseFloat(k[4])).filter((n) => Number.isFinite(n) && n > 0);
      if (closes.length < 202) continue;

      // Excluir vela em formação
      const lastClosed = ascending[ascending.length - 2];
      if (!lastClosed) continue;
      const turnover1h = Number(lastClosed[6] || 0);
      if (!Number.isFinite(turnover1h) || turnover1h < minTurnover1hUsd) continue;

      const closedCloses = closes.slice(0, -1);
      const ma200Vals = closedCloses.slice(-200);
      if (ma200Vals.length < 200) continue;

      const ma200 = ma200Vals.reduce((sum, v) => sum + v, 0) / 200;
      const lastPrice = closedCloses[closedCloses.length - 1];
      if (!Number.isFinite(ma200) || ma200 <= 0 || !Number.isFinite(lastPrice) || lastPrice <= 0) continue;

      if (lastPrice <= ma200) continue;

      const distPriceMa200 = ((lastPrice - ma200) / ma200) * 100;
      results.push({
        symbol,
        baseAsset,
        // Campo legado na BD; agora guarda turnover1h em USDT.
        marketCap: turnover1h,
        lastPrice,
        ma200,
        distPriceMa200,
      });
    } catch {
      // ignora falha pontual por símbolo
    }
    await delay(i % 5 === 4 ? 180 : 100);
  }

  results.sort((a, b) => b.marketCap - a.marketCap);
  return results.slice(0, limit).map((item, idx) => ({ ...item, rank: idx + 1 }));
}

export interface BybitAboveMa2004hVolItem {
  symbol: string;
  baseAsset: string;
  turnover4h: number;
  lastPrice: number;
  ma200: number;
  distPriceMa200: number;
  rank: number;
}

export interface BybitTradfiAboveMa2004hItem {
  symbol: string;
  baseAsset: string;
  lastPrice: number;
  ma200: number;
  distPriceMa200: number;
  rank: number;
}

/**
 * Scan Bybit 4h (USDT Perpetual):
 * - símbolos listados/trading na Bybit
 * - turnover da última vela 4h fechada >= minTurnover4hUsd
 * - preço (close 4h fechado) acima da MA200 (4h)
 */
export async function fetchBybitAboveMa2004hVol(
  limit: number = 300,
  minTurnover4hUsd: number = 2_000_000
): Promise<BybitAboveMa2004hVolItem[]> {
  type BybitInstrument = {
    symbol?: string;
    status?: string;
    quoteCoin?: string;
  };

  const bybitSymbolsRes = await fetch(
    'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'
  );
  if (!bybitSymbolsRes.ok) {
    throw new Error(`Erro ao buscar instrumentos Bybit (4h): ${bybitSymbolsRes.statusText}`);
  }

  const bybitSymbolsJson = await bybitSymbolsRes.json();
  const bybitList: BybitInstrument[] = bybitSymbolsJson?.result?.list ?? [];
  const bybitUsdtSymbols = bybitList
    .filter((item) => item.status === 'Trading' && item.quoteCoin === 'USDT' && item.symbol?.endsWith('USDT'))
    .map((item) => String(item.symbol));

  if (bybitUsdtSymbols.length === 0) return [];

  const results: Omit<BybitAboveMa2004hVolItem, 'rank'>[] = [];
  for (let i = 0; i < bybitUsdtSymbols.length; i++) {
    const symbol = bybitUsdtSymbols[i];
    const baseAsset = symbol.replace(/USDT$/, '');
    try {
      const klineRes = await fetch(
        `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=240&limit=210`
      );
      if (!klineRes.ok) continue;
      const klineJson = await klineRes.json();
      const rawList: string[][] = klineJson?.result?.list ?? [];
      if (rawList.length < 202) continue;

      const ascending = rawList.slice().reverse();
      const closes = ascending.map((k) => parseFloat(k[4])).filter((n) => Number.isFinite(n) && n > 0);
      if (closes.length < 202) continue;

      const lastClosed = ascending[ascending.length - 2];
      if (!lastClosed) continue;
      const turnover4h = Number(lastClosed[6] || 0);
      if (!Number.isFinite(turnover4h) || turnover4h < minTurnover4hUsd) continue;

      const closedCloses = closes.slice(0, -1);
      const ma200Vals = closedCloses.slice(-200);
      if (ma200Vals.length < 200) continue;

      const ma200 = ma200Vals.reduce((sum, v) => sum + v, 0) / 200;
      const lastPrice = closedCloses[closedCloses.length - 1];
      if (!Number.isFinite(ma200) || ma200 <= 0 || !Number.isFinite(lastPrice) || lastPrice <= 0) continue;
      if (lastPrice <= ma200) continue;

      const distPriceMa200 = ((lastPrice - ma200) / ma200) * 100;
      results.push({
        symbol,
        baseAsset,
        turnover4h,
        lastPrice,
        ma200,
        distPriceMa200,
      });
    } catch {
      // ignora falha pontual por símbolo
    }
    await delay(i % 5 === 4 ? 180 : 100);
  }

  results.sort((a, b) => b.turnover4h - a.turnover4h);
  return results.slice(0, limit).map((item, idx) => ({ ...item, rank: idx + 1 }));
}

export type BybitInstrumentPublicRow = {
  symbol?: string;
  status?: string;
  quoteCoin?: string;
  symbolType?: string;
  baseCoin?: string;
};

export type BybitTradfiSymbolEntry = {
  symbol: string;
  baseAsset: string;
  category: 'linear' | 'spot';
  status: string;
  symbolType: string;
};

/**
 * Percorre /v5/market/instruments-info com cursor até esgotar (API pública).
 */
export async function fetchBybitInstrumentsInfoAllPages(
  category: 'linear' | 'spot'
): Promise<BybitInstrumentPublicRow[]> {
  const all: BybitInstrumentPublicRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const url = new URL('https://api.bybit.com/v5/market/instruments-info');
    url.searchParams.set('category', category);
    url.searchParams.set('limit', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`instruments-info ${category}: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (typeof json?.retCode === 'number' && json.retCode !== 0) {
      throw new Error(json.retMsg ?? `instruments-info ${category} retCode=${json.retCode}`);
    }
    const list: BybitInstrumentPublicRow[] = json?.result?.list ?? [];
    all.push(...list);
    const next = json?.result?.nextPageCursor;
    if (next == null || String(next).trim() === '') break;
    cursor = String(next);
  }
  return all;
}

const TRADFI_SCAN_STATUSES = new Set(['Trading', 'PreLaunch']);

function isUsdtOrUsdcStockPair(item: BybitInstrumentPublicRow): boolean {
  const sym = item.symbol?.toUpperCase() ?? '';
  const q = item.quoteCoin?.toUpperCase();
  if (q === 'USDT') return sym.endsWith('USDT');
  if (q === 'USDC') return sym.endsWith('USDC');
  return sym.endsWith('USDT') || sym.endsWith('USDC');
}

function baseAssetFromSymbol(item: BybitInstrumentPublicRow): string {
  const sym = String(item.symbol ?? '');
  if (item.baseCoin) return String(item.baseCoin);
  return sym.replace(/(USDT|USDC)$/, '') || sym;
}

/**
 * Máximo de TradFi que a API pública lista: linear `stock` + spot `xstocks`,
 * USDT/USDC, estados Trading e PreLaunch (pre-listing continua a ter klines na maior parte dos casos).
 */
export function parseBybitTradfiSymbolUniverse(
  linearList: BybitInstrumentPublicRow[],
  spotList: BybitInstrumentPublicRow[]
): { linearStocks: BybitTradfiSymbolEntry[]; spotXstocks: BybitTradfiSymbolEntry[] } {
  const linearStocks: BybitTradfiSymbolEntry[] = linearList
    .filter(
      (item) =>
        item.symbol &&
        TRADFI_SCAN_STATUSES.has(String(item.status ?? '')) &&
        (item.quoteCoin === 'USDT' || item.quoteCoin === 'USDC') &&
        item.symbolType === 'stock' &&
        isUsdtOrUsdcStockPair(item)
    )
    .map((item) => ({
      symbol: String(item.symbol),
      baseAsset: baseAssetFromSymbol(item),
      category: 'linear' as const,
      status: String(item.status ?? ''),
      symbolType: 'stock',
    }));

  const spotXstocks: BybitTradfiSymbolEntry[] = spotList
    .filter(
      (item) =>
        item.symbol &&
        TRADFI_SCAN_STATUSES.has(String(item.status ?? '')) &&
        (item.quoteCoin === 'USDT' || item.quoteCoin === 'USDC') &&
        item.symbolType === 'xstocks' &&
        isUsdtOrUsdcStockPair(item)
    )
    .map((item) => ({
      symbol: String(item.symbol),
      baseAsset: baseAssetFromSymbol(item),
      category: 'spot' as const,
      status: String(item.status ?? ''),
      symbolType: 'xstocks',
    }));

  return { linearStocks, spotXstocks };
}

/** Lista única para o scan: linear primeiro, depois spot (evita klines duplicados se o símbolo repetir). */
export function mergeTradfiSymbolEntriesForScan(
  linearStocks: BybitTradfiSymbolEntry[],
  spotXstocks: BybitTradfiSymbolEntry[]
): Array<{ symbol: string; baseAsset: string; category: 'linear' | 'spot' }> {
  const seen = new Set<string>();
  const out: Array<{ symbol: string; baseAsset: string; category: 'linear' | 'spot' }> = [];
  for (const e of linearStocks) {
    if (seen.has(e.symbol)) continue;
    seen.add(e.symbol);
    out.push({ symbol: e.symbol, baseAsset: e.baseAsset, category: e.category });
  }
  for (const e of spotXstocks) {
    if (seen.has(e.symbol)) continue;
    seen.add(e.symbol);
    out.push({ symbol: e.symbol, baseAsset: e.baseAsset, category: e.category });
  }
  return out;
}

/**
 * Scan Bybit TradFi Stocks 4h (linear `stock` + spot `xstocks`, USDT/USDC, Trading e PreLaunch):
 * - sem filtro de volume/turnover
 * - sem filtro por MA (lista todos com histórico mínimo de velas fechadas)
 * @param limit máximo de linhas no resultado; `0` = sem limite (todos os que passarem o scan)
 */
export async function fetchBybitTradfiAboveMa2004h(
  limit: number = 0
): Promise<BybitTradfiAboveMa2004hItem[]> {
  const [linearList, spotList] = await Promise.all([
    fetchBybitInstrumentsInfoAllPages('linear'),
    fetchBybitInstrumentsInfoAllPages('spot'),
  ]);
  console.log(`[TradFi Scan 4h] instrumentos recebidos: linear=${linearList.length} spot=${spotList.length}`);

  const { linearStocks, spotXstocks } = parseBybitTradfiSymbolUniverse(linearList, spotList);
  const bybitTradfiSymbols = mergeTradfiSymbolEntriesForScan(linearStocks, spotXstocks);
  console.log(
    `[TradFi Scan 4h] símbolos elegíveis: linear_stock=${linearStocks.length} spot_xstocks=${spotXstocks.length} unicos=${bybitTradfiSymbols.length}`
  );
  if (bybitTradfiSymbols.length === 0) return [];

  const results: Omit<BybitTradfiAboveMa2004hItem, 'rank'>[] = [];
  let klineFetchFail = 0;
  let noClosedCandles = 0;
  let insufficientClosedCandles = 0;
  for (let i = 0; i < bybitTradfiSymbols.length; i++) {
    const { symbol, baseAsset, category } = bybitTradfiSymbols[i];
    try {
      const klineRes = await fetch(
        `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${encodeURIComponent(symbol)}&interval=240&limit=1000`
      );
      if (!klineRes.ok) {
        klineFetchFail++;
        continue;
      }
      const klineJson = await klineRes.json();
      const rawList: string[][] = klineJson?.result?.list ?? [];

      const ascending = rawList.slice().reverse();
      const closes = ascending.map((k) => parseFloat(k[4])).filter((n) => Number.isFinite(n) && n > 0);
      if (closes.length < 2) {
        noClosedCandles++;
        continue;
      }

      const closedCloses = closes.slice(0, -1);
      if (closedCloses.length < 20) {
        insufficientClosedCandles++;
        continue;
      }
      // TradFi stocks foram listados recentemente; usa MA adaptativa para não ficar sem universo.
      const maPeriod = Math.min(200, closedCloses.length);
      const maVals = closedCloses.slice(-maPeriod);
      if (maVals.length < 20) {
        insufficientClosedCandles++;
        continue;
      }

      const ma200 = maVals.reduce((sum, v) => sum + v, 0) / maPeriod;
      const lastPrice = closedCloses[closedCloses.length - 1];
      if (!Number.isFinite(ma200) || ma200 <= 0 || !Number.isFinite(lastPrice) || lastPrice <= 0) continue;

      const distPriceMa200 = ((lastPrice - ma200) / ma200) * 100;
      results.push({
        symbol,
        baseAsset,
        lastPrice,
        ma200,
        distPriceMa200,
      });
    } catch {
      // ignora falha pontual por símbolo
      klineFetchFail++;
    }
    await delay(i % 5 === 4 ? 180 : 100);
  }

  results.sort((a, b) => b.distPriceMa200 - a.distPriceMa200);
  console.log(
    `[TradFi Scan 4h] resumo: total=${bybitTradfiSymbols.length} | semKline=${klineFetchFail} | semFecho=${noClosedCandles} | historico<20=${insufficientClosedCandles} | listados=${results.length}`
  );
  const cap = limit > 0 ? limit : results.length;
  return results.slice(0, cap).map((item, idx) => ({ ...item, rank: idx + 1 }));
}

export async function fetchTopVolatile(limit: number = 25): Promise<TopVolatileItem[]> {
  try {
    const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!tickerRes.ok) throw new Error('Erro ao buscar tickers');
    const tickerData = await tickerRes.json();

    const symbols = tickerData
      .filter((t: any) => t.symbol?.endsWith('USDT') && !t.symbol?.includes('BUSD') && parseFloat(t.quoteVolume || '0') > 500000)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 200)
      .map((t: any) => t.symbol);

    const results: { symbol: string; high3m: number; low3m: number; volatilityPercent: number; lastPrice: number }[] = [];
    const scanStart = Date.now() - TOP_VOLATILE_SCAN_MS;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100&startTime=${scanStart}`
        );
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        if (klines.length < 7) continue;

        let high3m = -Infinity;
        let low3m = Infinity;
        for (const k of klines) {
          const h = parseFloat(k[2]);
          const l = parseFloat(k[3]);
          if (h > high3m) high3m = h;
          if (l < low3m && l > 0) low3m = l;
        }
        if (low3m <= 0 || !isFinite(high3m)) continue;

        const volatilityPercent = ((high3m - low3m) / low3m) * 100;
        const lastPrice = parseFloat(klines[klines.length - 1][4]);

        results.push({ symbol, high3m, low3m, volatilityPercent, lastPrice });
      } catch {
        // ignorar falha por símbolo
      }
      await delay(i % 5 === 4 ? 150 : 80);
    }

    results.sort((a, b) => b.volatilityPercent - a.volatilityPercent);
    return results.slice(0, limit).map((r, i) => ({
      ...r,
      rank: i + 1,
    }));
  } catch (error) {
    console.error('Erro ao buscar Top Voláteis:', error);
    throw error;
  }
}
