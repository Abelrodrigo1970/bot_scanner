/**
 * Cliente Binance Futures com assinatura HMAC.
 * Fase 1: apenas funções de leitura (positionRisk, price) e estrutura para ordens.
 * Nenhuma ordem é criada até o executor ser implementado.
 */

import crypto from 'crypto';
import {
  getBinanceFuturesBaseUrl,
  hasTradingCredentials,
} from './binanceConfig';

const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

function createSignature(queryString: string): string {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

async function signedRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  if (!hasTradingCredentials()) {
    throw new Error('BINANCE_API_KEY e BINANCE_API_SECRET são obrigatórios');
  }

  const baseUrl = getBinanceFuturesBaseUrl();
  const timestamp = Date.now();
  const allParams = { ...params, timestamp: String(timestamp) };
  const queryString = Object.entries(allParams)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const signature = createSignature(queryString);
  const url = `${baseUrl}${path}?${queryString}&signature=${signature}`;

  const response = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  const rawBody = await response.text();
  let data: unknown;
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    const preview = rawBody.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Resposta não-JSON da Binance em ${path}: HTTP ${response.status}${preview ? ` | ${preview}` : ''}`
    );
  }

  if (!response.ok) {
    const msg = typeof data === 'object' && data !== null && 'msg' in data
      ? String((data as { msg?: string }).msg || response.statusText)
      : response.statusText;
    throw new Error(`Binance API: ${msg} (${response.status})`);
  }

  return data as T;
}

/**
 * Lista posições abertas (Futures USDⓈ-M).
 * A Binance retirou /fapi/v1/positionRisk; usamos v3 e fallback para v2.
 * Posições com positionAmt = 0 também podem aparecer; filtrar por positionAmt != 0 para ativas.
 */
export async function getPositionRisk(): Promise<Array<{
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  leverage: string;
}>> {
  try {
    return await signedRequest('GET', '/fapi/v3/positionRisk');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes('/fapi/v3/positionRisk') ||
      msg.includes('404') ||
      msg.includes('retired')
    ) {
      return signedRequest('GET', '/fapi/v2/positionRisk');
    }
    throw error;
  }
}

/**
 * Preço atual de um símbolo (endpoint público, sem autenticação).
 */
export async function getTickerPrice(symbol: string): Promise<number> {
  const baseUrl = getBinanceFuturesBaseUrl();
  const response = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`);
  if (!response.ok) {
    throw new Error(`Erro ao buscar preço ${symbol}: ${response.statusText}`);
  }
  const data = (await response.json()) as { price: string };
  return parseFloat(data.price);
}

/**
 * Informação do símbolo (lot size, precision, etc.).
 */
export async function getExchangeInfo(symbol?: string): Promise<{
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: Array<Record<string, string>>;
  }>;
}> {
  const baseUrl = getBinanceFuturesBaseUrl();
  const url = symbol
    ? `${baseUrl}/fapi/v1/exchangeInfo?symbol=${symbol}`
    : `${baseUrl}/fapi/v1/exchangeInfo`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erro ExchangeInfo: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Nova ordem (MARKET, LIMIT). STOP_MARKET usa createAlgoOrder.
 */
export async function createOrder(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity?: string;
  price?: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  reduceOnly?: boolean;
}): Promise<{ orderId: number; symbol: string; status: string }> {
  const p: Record<string, string> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };
  if (params.quantity) p.quantity = params.quantity;
  if (params.price) p.price = params.price;
  if (params.timeInForce) p.timeInForce = params.timeInForce;
  if (params.reduceOnly) p.reduceOnly = 'true';

  return signedRequest('POST', '/fapi/v1/order', p);
}

/**
 * Ordem Algo (STOP_MARKET, TAKE_PROFIT_MARKET).
 * Binance migrou STOP_MARKET para /fapi/v1/algoOrder.
 */
export async function createAlgoOrder(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  triggerPrice: string;
  closePosition?: boolean;
  quantity?: string;
  workingType?: 'MARK_PRICE' | 'CONTRACT_PRICE';
  reduceOnly?: boolean;
}): Promise<{ algoId: number; symbol: string; algoStatus: string }> {
  const p: Record<string, string> = {
    algoType: 'CONDITIONAL',
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    triggerPrice: params.triggerPrice,
  };
  if (params.closePosition) p.closePosition = 'true';
  if (params.quantity && !params.closePosition) p.quantity = params.quantity;
  if (params.workingType) p.workingType = params.workingType;
  if (params.reduceOnly && !params.closePosition) p.reduceOnly = 'true';

  return signedRequest('POST', '/fapi/v1/algoOrder', p);
}

/**
 * Obtém step size para arredondar quantity (LOT_SIZE filter).
 */
export async function getLotSizeStep(symbol: string): Promise<number> {
  const info = await getExchangeInfo(symbol);
  const sym = info.symbols?.find((s) => s.symbol === symbol);
  const lotFilter = sym?.filters?.find((f: Record<string, string>) => f.filterType === 'LOT_SIZE');
  const step = lotFilter?.stepSize ?? '0.001';
  return parseFloat(step);
}

/**
 * Obtém tick size para arredondar preço (PRICE_FILTER).
 */
export async function getTickSize(symbol: string): Promise<number> {
  const info = await getExchangeInfo(symbol);
  const sym = info.symbols?.find((s) => s.symbol === symbol);
  const priceFilter = sym?.filters?.find((f: Record<string, string>) => f.filterType === 'PRICE_FILTER');
  const tick = priceFilter?.tickSize ?? '0.01';
  return parseFloat(tick);
}
