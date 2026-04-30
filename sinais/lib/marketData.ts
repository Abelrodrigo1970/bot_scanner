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
  try {
    let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    if (startTime) {
      url += `&startTime=${startTime}`;
    }
    if (endTime) {
      url += `&endTime=${endTime}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const error: any = new Error(`Erro ao buscar dados: ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();

    return data.map((candle: any[]) => ({
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
      timestamp: candle[0],
    }));
  } catch (error) {
    console.error(`Erro ao buscar candles para ${symbol}:`, error);
    throw error;
  }
}

/**
 * Busca o preço atual de um par (Futures USDⓈ-M)
 * Retry em caso de Bad Request/erro temporário da API
 */
export async function fetchCurrentPrice(symbol: string, retries = 2): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`
      );

      if (!response.ok) {
        if (response.status === 400 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new Error(`Erro ao buscar preço: ${response.statusText}`);
      }

      const data = await response.json();
      return parseFloat(data.price);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      } else {
        console.error(`Erro ao buscar preço para ${symbol}:`, error);
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Lista de símbolos padrão para análise
 */
export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'];

/**
 * Intervalos de tempo suportados
 */
export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

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

/** Atraso em ms (evitar rate limit da Binance) */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  high3m: number;
  low3m: number;
  volatilityPercent: number;
  lastPrice: number;
  rank: number;
}

/**
 * Busca as top 25 criptos mais voláteis dos últimos 3 meses.
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

/** MA30 mais de 5% abaixo da MA200: (MA30−MA200)/MA200×100 < −5. */
const MA30_VS_MA200_BELOW_THRESHOLD_PCT = -5;

/**
 * Scan: MA30 **abaixo** da MA200 em 1h (SMA), com separação relativa **inferior a −5%**
 * ((MA30−MA200)/MA200×100 < −5). Top 300 por volume Binance Futures.
 * Ordenado do mais “apertado” (mais perto de −5%) para o mais afastado (mais negativo).
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
        if (distMa30Ma200 >= MA30_VS_MA200_BELOW_THRESHOLD_PCT) {
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
    console.error('Erro ao buscar MA30 < −5% vs MA200 (1h):', error);
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

/**
 * Scan Bybit TradFi Stocks 4h (via category=linear + symbolType=stock):
 * - símbolos stock em estado Trading
 * - preço (close 4h fechado) acima da MA200 (4h)
 * - sem filtro de volume/turnover
 */
export async function fetchBybitTradfiAboveMa2004h(
  limit: number = 300
): Promise<BybitTradfiAboveMa2004hItem[]> {
  type BybitInstrument = {
    symbol?: string;
    status?: string;
    quoteCoin?: string;
    symbolType?: string;
    baseCoin?: string;
  };

  const bybitSymbolsRes = await fetch(
    'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'
  );
  if (!bybitSymbolsRes.ok) {
    throw new Error(`Erro ao buscar instrumentos Bybit TradFi (4h): ${bybitSymbolsRes.statusText}`);
  }

  const bybitSymbolsJson = await bybitSymbolsRes.json();
  const bybitList: BybitInstrument[] = bybitSymbolsJson?.result?.list ?? [];
  const bybitTradfiSymbols = bybitList
    .filter(
      (item) =>
        item.status === 'Trading' &&
        item.quoteCoin === 'USDT' &&
        item.symbolType === 'stock' &&
        item.symbol?.endsWith('USDT')
    )
    .map((item) => ({
      symbol: String(item.symbol),
      baseAsset: String(item.baseCoin ?? item.symbol?.replace(/USDT$/, '') ?? ''),
    }));

  if (bybitTradfiSymbols.length === 0) return [];

  const results: Omit<BybitTradfiAboveMa2004hItem, 'rank'>[] = [];
  for (let i = 0; i < bybitTradfiSymbols.length; i++) {
    const { symbol, baseAsset } = bybitTradfiSymbols[i];
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

      const closedCloses = closes.slice(0, -1);
      if (closedCloses.length < 20) continue;
      // TradFi stocks foram listados recentemente; usa MA adaptativa para não ficar sem universo.
      const maPeriod = Math.min(200, closedCloses.length);
      const maVals = closedCloses.slice(-maPeriod);
      if (maVals.length < 20) continue;

      const ma200 = maVals.reduce((sum, v) => sum + v, 0) / maPeriod;
      const lastPrice = closedCloses[closedCloses.length - 1];
      if (!Number.isFinite(ma200) || ma200 <= 0 || !Number.isFinite(lastPrice) || lastPrice <= 0) continue;
      if (lastPrice <= ma200) continue;

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
    }
    await delay(i % 5 === 4 ? 180 : 100);
  }

  results.sort((a, b) => b.distPriceMa200 - a.distPriceMa200);
  return results.slice(0, limit).map((item, idx) => ({ ...item, rank: idx + 1 }));
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
    const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100&startTime=${threeMonthsAgo}`
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
