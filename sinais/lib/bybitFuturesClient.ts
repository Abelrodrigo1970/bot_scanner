/**
 * Cliente Bybit V5 API — Linear Futures (USDT Perpetual).
 * Autenticação: HMAC-SHA256 sobre timestamp + apiKey + recvWindow + payload.
 * Docs: https://bybit-exchange.github.io/docs/v5/intro
 */

import crypto from 'crypto';
import { getBybitBaseUrl, hasBybitCredentials } from './bybitConfig';

const RECV_WINDOW = '5000';

function getCredentials() {
  return {
    apiKey:    process.env.BYBIT_API_KEY    || '',
    apiSecret: process.env.BYBIT_API_SECRET || '',
  };
}

function createSignature(payload: string): string {
  const { apiSecret } = getCredentials();
  return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
}

// ---------------------------------------------------------------------------
// GET request (query string assinada no header)
// ---------------------------------------------------------------------------
async function signedGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!hasBybitCredentials()) throw new Error('BYBIT_API_KEY e BYBIT_API_SECRET são obrigatórios');

  const { apiKey } = getCredentials();
  const timestamp  = String(Date.now());
  const queryString = new URLSearchParams(params).toString();
  const sigPayload  = `${timestamp}${apiKey}${RECV_WINDOW}${queryString}`;
  const signature   = createSignature(sigPayload);

  const url = `${getBybitBaseUrl()}${path}${queryString ? `?${queryString}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY':      apiKey,
      'X-BAPI-SIGN':         signature,
      'X-BAPI-TIMESTAMP':    timestamp,
      'X-BAPI-RECV-WINDOW':  RECV_WINDOW,
    },
  });

  const data = await response.json() as { retCode: number; retMsg: string; result: T };
  if (data.retCode !== 0) throw new Error(`Bybit API: ${data.retMsg} (retCode ${data.retCode})`);
  return data.result;
}

// ---------------------------------------------------------------------------
// POST request (body JSON assinado no header)
// ---------------------------------------------------------------------------
async function signedPost<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!hasBybitCredentials()) throw new Error('BYBIT_API_KEY e BYBIT_API_SECRET são obrigatórios');

  const { apiKey } = getCredentials();
  const timestamp  = String(Date.now());
  const rawBody    = JSON.stringify(body);
  const sigPayload = `${timestamp}${apiKey}${RECV_WINDOW}${rawBody}`;
  const signature  = createSignature(sigPayload);

  const response = await fetch(`${getBybitBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY':     apiKey,
      'X-BAPI-SIGN':        signature,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'Content-Type':       'application/json',
    },
    body: rawBody,
  });

  const data = await response.json() as { retCode: number; retMsg: string; result: T };
  if (data.retCode !== 0) throw new Error(`Bybit API: ${data.retMsg} (retCode ${data.retCode})`);
  return data.result;
}

// ---------------------------------------------------------------------------
// Posições abertas
// ---------------------------------------------------------------------------
export async function getBybitPositionRisk(symbol?: string): Promise<Array<{
  symbol:        string;
  side:          'Buy' | 'Sell' | 'None';
  size:          string;
  avgPrice:      string;
  unrealisedPnl: string;
  leverage:      string;
}>> {
  const params: Record<string, string> = { category: 'linear' };
  if (symbol) params.symbol = symbol;

  const result = await signedGet<{ list: Array<Record<string, string>> }>('/v5/position/list', params);
  return (result?.list ?? []).map((p) => ({
    symbol:        p.symbol        ?? '',
    side:          (p.side ?? 'None') as 'Buy' | 'Sell' | 'None',
    size:          p.size          ?? '0',
    avgPrice:      p.avgPrice      ?? '0',
    unrealisedPnl: p.unrealisedPnl ?? '0',
    leverage:      p.leverage      ?? '1',
  }));
}

// ---------------------------------------------------------------------------
// Criar ordem (entrada MARKET ou conditional TP/SL)
// ---------------------------------------------------------------------------
export async function createBybitOrder(params: {
  symbol:           string;
  side:             'Buy' | 'Sell';
  qty:              string;
  stopLoss?:        string;
  slTriggerBy?:     'MarkPrice' | 'LastPrice';
  // Para ordens condicionais (TP / SL separados):
  stopOrderType?:   'TakeProfit' | 'StopLoss';
  triggerPrice?:    string;
  triggerBy?:       'MarkPrice' | 'LastPrice';
  /** 1 = preço sobe até ao trigger (TP de BUY) | 2 = preço desce até ao trigger (TP de SELL) */
  triggerDirection?: 1 | 2;
  reduceOnly?:      boolean;
}): Promise<{ orderId: string; symbol: string; orderStatus: string }> {
  const body: Record<string, unknown> = {
    category:  'linear',
    symbol:    params.symbol,
    side:      params.side,
    orderType: 'Market',
    qty:       params.qty,
    timeInForce: 'IOC',
  };

  if (params.stopLoss)           body.stopLoss        = params.stopLoss;
  if (params.slTriggerBy)        body.slTriggerBy     = params.slTriggerBy;
  if (params.stopOrderType)      body.stopOrderType   = params.stopOrderType;
  if (params.triggerPrice)       body.triggerPrice    = params.triggerPrice;
  if (params.triggerBy)          body.triggerBy       = params.triggerBy;
  if (params.triggerDirection)   body.triggerDirection = params.triggerDirection;
  if (params.reduceOnly)         body.reduceOnly      = true;

  return signedPost<{ orderId: string; symbol: string; orderStatus: string }>('/v5/order/create', body);
}

// ---------------------------------------------------------------------------
// Informação do símbolo — step size e tick size
// ---------------------------------------------------------------------------
async function getInstrumentInfo(symbol: string): Promise<{
  lotSizeFilter: { qtyStep: string };
  priceFilter:   { tickSize: string };
} | null> {
  try {
    const result = await signedGet<{ list: Array<Record<string, Record<string, string>>> }>(
      '/v5/market/instruments-info',
      { category: 'linear', symbol }
    );
    return (result?.list?.[0] ?? null) as {
      lotSizeFilter: { qtyStep: string };
      priceFilter:   { tickSize: string };
    } | null;
  } catch {
    return null;
  }
}

export async function getBybitLotSizeStep(symbol: string): Promise<number> {
  const info = await getInstrumentInfo(symbol);
  const step = info?.lotSizeFilter?.qtyStep ?? '0.001';
  return parseFloat(step);
}

export async function getBybitTickSize(symbol: string): Promise<number> {
  const info = await getInstrumentInfo(symbol);
  const tick = info?.priceFilter?.tickSize ?? '0.01';
  return parseFloat(tick);
}
