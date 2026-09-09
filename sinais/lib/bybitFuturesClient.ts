/**
 * Cliente Bybit V5 API — Linear Futures (USDT Perpetual).
 * Autenticação: HMAC-SHA256 sobre timestamp + apiKey + recvWindow + payload.
 * Docs: https://bybit-exchange.github.io/docs/v5/intro
 */

import crypto from 'crypto';
import type { ProxyAgent as UndiciProxyAgent } from 'undici';
import type { BybitInstrumentPublicRow } from './marketData';
import { getBybitBaseUrl, hasBybitCredentials } from './bybitConfig';

const RECV_WINDOW = '5000';

// ---------------------------------------------------------------------------
// Proxy (BYBIT_PROXY_URL ou fallback para MARKET_DATA_PROXY_URL)
// Usado quando o IP da Railway é bloqueado pelo CloudFront da Bybit.
// ---------------------------------------------------------------------------
let _bybitProxyAgent: UndiciProxyAgent | null | undefined = undefined;
let _bybitProxyDisabledForSession = false;
let _bybitProxyDisabledWarned = false;

function isBybitProxyTunnelError(err: unknown): boolean {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  const text = parts.join(' ');
  return /402|Proxy response|HTTP Tunneling|UND_ERR_ABORTED|proxy/i.test(text);
}

function disableBybitProxyForSession(reason: string): void {
  if (_bybitProxyDisabledForSession) return;
  _bybitProxyDisabledForSession = true;
  _bybitProxyAgent = null;
  if (!_bybitProxyDisabledWarned) {
    _bybitProxyDisabledWarned = true;
    console.warn(
      `⚠️ BYBIT_PROXY_URL / MARKET_DATA_PROXY_URL desactivado nesta sessão (${reason}). Pedidos Bybit seguem directos.`
    );
  }
}

async function getBybitProxyAgent(): Promise<UndiciProxyAgent | null> {
  if (_bybitProxyDisabledForSession) return null;
  const proxyUrl = process.env.BYBIT_PROXY_URL?.trim();
  if (!proxyUrl) return null;
  if (_bybitProxyAgent !== undefined) return _bybitProxyAgent;
  try {
    const { ProxyAgent } = await import('undici');
    _bybitProxyAgent = new ProxyAgent(proxyUrl);
    console.log(`ℹ️ Bybit client: proxy activo → ${proxyUrl.replace(/:([^@/]+)@/, ':***@')}`);
  } catch (e) {
    _bybitProxyAgent = null;
  }
  return _bybitProxyAgent;
}

async function bybitFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const agent = await getBybitProxyAgent();
  if (!agent) return fetch(url, init);
  try {
    const { fetch: undiciFetch } = await import('undici');
    return undiciFetch(url, { ...init, dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  } catch (err) {
    if (isBybitProxyTunnelError(err)) {
      disableBybitProxyForSession('proxy 402 / túnel HTTP falhou');
      return fetch(url, init);
    }
    throw err;
  }
}

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

// Lê a resposta como texto e só depois faz parse, para que um corpo não-JSON
// (ex.: HTML 403 da CloudFront ao geo-bloquear o IP) gere um erro claro em vez
// de "Expected property name or '}' in JSON at position N".
async function parseBybitResponse<T>(response: Response): Promise<{ retCode: number; retMsg: string; result: T }> {
  const text = await response.text();
  const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  if (!response.ok) {
    throw new Error(`Bybit HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`);
  }
  try {
    return JSON.parse(text) as { retCode: number; retMsg: string; result: T };
  } catch {
    throw new Error(`Bybit resposta não-JSON (HTTP ${response.status})${snippet ? ` — ${snippet}` : ''}`);
  }
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
  const response = await bybitFetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY':      apiKey,
      'X-BAPI-SIGN':         signature,
      'X-BAPI-TIMESTAMP':    timestamp,
      'X-BAPI-RECV-WINDOW':  RECV_WINDOW,
    },
  });

  const data = await parseBybitResponse<T>(response);
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

  const response = await bybitFetch(`${getBybitBaseUrl()}${path}`, {
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

  const data = await parseBybitResponse<T>(response);
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
  stopLoss:      string;
  takeProfit:    string;
  positionIdx:   number;
}>> {
  const params: Record<string, string> = { category: 'linear' };
  if (symbol) params.symbol = symbol;
  else params.settleCoin = 'USDT';

  const result = await signedGet<{ list: Array<Record<string, string>> }>('/v5/position/list', params);
  return (result?.list ?? []).map((p) => ({
    symbol:        p.symbol        ?? '',
    side:          (p.side ?? 'None') as 'Buy' | 'Sell' | 'None',
    size:          p.size          ?? '0',
    avgPrice:      p.avgPrice      ?? '0',
    unrealisedPnl: p.unrealisedPnl ?? '0',
    leverage:      p.leverage      ?? '1',
    stopLoss:      p.stopLoss      ?? '',
    takeProfit:    p.takeProfit    ?? '',
    positionIdx:   Number.parseInt(p.positionIdx ?? '0', 10) || 0,
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
  closeOnTrigger?:  boolean;
  positionIdx?:     0 | 1 | 2;
}): Promise<{ orderId: string; symbol: string; orderStatus: string }> {
  const body: Record<string, unknown> = {
    category:  'linear',
    symbol:    params.symbol,
    side:      params.side,
    orderType: 'Market',
    qty:       params.qty,
    timeInForce: 'IOC',
    positionIdx: params.positionIdx ?? 0,
  };

  if (params.stopLoss) {
    // Full position SL (Market) — sem tpslMode a Bybit por vezes aceita a entrada e ignora o SL
    body.stopLoss = params.stopLoss;
    body.tpslMode = 'Full';
    body.slOrderType = 'Market';
    if (params.slTriggerBy) body.slTriggerBy = params.slTriggerBy;
  }
  if (params.stopOrderType)      body.stopOrderType   = params.stopOrderType;
  if (params.triggerPrice)       body.triggerPrice    = params.triggerPrice;
  if (params.triggerBy)          body.triggerBy       = params.triggerBy;
  if (params.triggerDirection)   body.triggerDirection = params.triggerDirection;
  if (params.reduceOnly)         body.reduceOnly      = true;
  if (params.closeOnTrigger)     body.closeOnTrigger  = true;

  return signedPost<{ orderId: string; symbol: string; orderStatus: string }>('/v5/order/create', body);
}

/**
 * Define / confirma SL (e opcionalmente TP) ao nível da posição.
 * Usar após fill de market — garante SL mesmo se o attach na create-order falhar.
 */
export async function setBybitTradingStop(params: {
  symbol: string;
  stopLoss: string;
  slTriggerBy?: 'MarkPrice' | 'LastPrice' | 'IndexPrice';
  takeProfit?: string;
  tpTriggerBy?: 'MarkPrice' | 'LastPrice' | 'IndexPrice';
  /** 0 = one-way (default); hedge: 1=Buy, 2=Sell */
  positionIdx?: 0 | 1 | 2;
}): Promise<void> {
  const body: Record<string, unknown> = {
    category: 'linear',
    symbol: params.symbol,
    tpslMode: 'Full',
    stopLoss: params.stopLoss,
    slTriggerBy: params.slTriggerBy ?? 'MarkPrice',
    slOrderType: 'Market',
    positionIdx: params.positionIdx ?? 0,
  };
  if (params.takeProfit) {
    body.takeProfit = params.takeProfit;
    body.tpTriggerBy = params.tpTriggerBy ?? 'MarkPrice';
    body.tpOrderType = 'Market';
  }
  await signedPost('/v5/position/trading-stop', body);
}

/**
 * Garante SL na posição: trading-stop (vários positionIdx) + verificação + stop condicional.
 * Ajusta o SL se o mark já o invalidou (comum em shorts que disparam logo após a entrada).
 */
export async function ensureBybitStopLoss(params: {
  symbol: string;
  side: 'Buy' | 'Sell';
  stopLoss: string;
  qty: string;
}): Promise<{ ok: boolean; method: 'position' | 'conditional' | 'none'; stopLoss?: string; error?: string }> {
  const hedgeIdx: 0 | 1 | 2 = params.side === 'Buy' ? 1 : 2;
  const idxTries: Array<0 | 1 | 2> = [0, hedgeIdx];

  let slPrice = parseFloat(params.stopLoss);
  if (!(slPrice > 0)) {
    return { ok: false, method: 'none', error: 'stopLoss inválido' };
  }

  // Qualquer SL já na posição conta (inclui manuais) — não sobrescrever
  try {
    const positions = await getBybitPositionRisk(params.symbol);
    const active = positions.find(
      (p) => p.symbol === params.symbol && parseFloat(p.size) > 0 && p.side === params.side
    );
    if (active?.stopLoss && parseFloat(active.stopLoss) > 0) {
      return { ok: true, method: 'position', stopLoss: active.stopLoss };
    }
  } catch {
    // continua
  }

  // Ajusta SL vs mark actual (Bybit rejeita SL do lado errado do preço)
  try {
    const tick = await getBybitTickSize(params.symbol);
    const mark = await fetchBybitMarkPrice(params.symbol);
    if (mark != null && mark > 0 && Number.isFinite(tick) && tick > 0) {
      const minGap = Math.max(mark * 0.002, tick * 10);
      if (params.side === 'Buy' && slPrice >= mark) {
        slPrice = Math.max(tick, mark - minGap);
      } else if (params.side === 'Sell' && slPrice <= mark) {
        slPrice = mark + minGap;
      }
      // arredondar ao tick
      const mult = slPrice / tick;
      slPrice =
        params.side === 'Buy' ? Math.floor(mult) * tick : Math.ceil(mult) * tick;
    }
  } catch {
    // usa sl original
  }

  const slStr = formatBybitPrice(slPrice);
  let lastErr = '';

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 350 * attempt));

    let positionIdx: 0 | 1 | 2 = 0;
    try {
      const positions = await getBybitPositionRisk(params.symbol);
      const active = positions.find(
        (p) => p.symbol === params.symbol && parseFloat(p.size) > 0 && p.side === params.side
      );
      if (active) {
        const idx = active.positionIdx;
        positionIdx = idx === 1 || idx === 2 ? idx : 0;
        if (active.stopLoss && parseFloat(active.stopLoss) > 0) {
          return { ok: true, method: 'position', stopLoss: active.stopLoss };
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }

    for (const idx of idxTries) {
      try {
        await setBybitTradingStop({
          symbol: params.symbol,
          stopLoss: slStr,
          slTriggerBy: 'MarkPrice',
          positionIdx: idx === 0 ? positionIdx || 0 : idx,
        });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        continue;
      }
      try {
        const positions = await getBybitPositionRisk(params.symbol);
        const active = positions.find(
          (p) => p.symbol === params.symbol && parseFloat(p.size) > 0 && p.side === params.side
        );
        if (active?.stopLoss && parseFloat(active.stopLoss) > 0) {
          return { ok: true, method: 'position', stopLoss: active.stopLoss };
        }
        lastErr = 'trading-stop OK mas posição sem stopLoss';
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
  }

  // Fallback: ordem stop condicional (closeOnTrigger)
  for (const idx of idxTries) {
    try {
      await createBybitOrder({
        symbol: params.symbol,
        side: params.side === 'Buy' ? 'Sell' : 'Buy',
        qty: params.qty,
        triggerPrice: slStr,
        triggerBy: 'MarkPrice',
        triggerDirection: params.side === 'Buy' ? 2 : 1,
        reduceOnly: true,
        closeOnTrigger: true,
        positionIdx: idx,
      });
      return { ok: true, method: 'conditional', stopLoss: slStr };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, method: 'none', error: lastErr || 'SL não aplicado' };
}

async function fetchBybitMarkPrice(symbol: string): Promise<number | null> {
  try {
    const result = await signedGet<{ list?: Array<{ markPrice?: string; lastPrice?: string }> }>(
      '/v5/market/tickers',
      { category: 'linear', symbol }
    );
    const row = result?.list?.[0];
    const mark = parseFloat(row?.markPrice || row?.lastPrice || '');
    return Number.isFinite(mark) && mark > 0 ? mark : null;
  } catch {
    return null;
  }
}

function formatBybitPrice(price: number): string {
  if (!(price > 0)) return '0';
  const s = price.toFixed(10).replace(/\.?0+$/, '');
  return s || String(price);
}

/** Cancela todas as ordens abertas / condicionais do par linear (inclui TP órfãs). */
export async function cancelAllBybitLinearOrders(symbol: string): Promise<void> {
  await signedPost('/v5/order/cancel-all', {
    category: 'linear',
    symbol,
  });
}

type OpenOrdersRealtimePage = {
  list?: Array<{ symbol?: string }>;
  nextPageCursor?: string;
};

/**
 * Símbolos linear USDT com pelo menos uma ordem aberta (paginação até esgotar cursor).
 */
export async function listOpenLinearOrderSymbols(): Promise<string[]> {
  const symbols = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const params: Record<string, string> = {
      category:   'linear',
      settleCoin: 'USDT',
      openOnly:   '0',
      limit:      '50',
    };
    if (cursor) params.cursor = cursor;
    const result = await signedGet<OpenOrdersRealtimePage>('/v5/order/realtime', params);
    for (const o of result?.list ?? []) {
      if (o.symbol) symbols.add(o.symbol);
    }
    const next = result?.nextPageCursor;
    if (next == null || String(next).trim() === '') break;
    cursor = String(next);
  }
  return [...symbols];
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

type AccountInstrumentsPage = {
  list?: BybitInstrumentPublicRow[];
  nextPageCursor?: string;
};

/**
 * GET /v5/account/instruments-info — pares que a **tua conta** pode negociar (requer API key).
 * Linear: pagina com `cursor` (máx. 200 por página na doc oficial).
 * Spot: um pedido — a Bybit indica que spot neste endpoint não usa paginação.
 * Docs: https://bybit-exchange.github.io/docs/v5/account/instrument
 */
export async function fetchBybitAccountInstrumentsInfoAllPages(
  category: 'linear' | 'spot'
): Promise<BybitInstrumentPublicRow[]> {
  if (!hasBybitCredentials()) {
    throw new Error('BYBIT_API_KEY e BYBIT_API_SECRET são obrigatórios');
  }

  if (category === 'spot') {
    const result = await signedGet<AccountInstrumentsPage>('/v5/account/instruments-info', {
      category: 'spot',
    });
    return result?.list ?? [];
  }

  const all: BybitInstrumentPublicRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const params: Record<string, string> = { category: 'linear', limit: '200' };
    if (cursor) params.cursor = cursor;
    const result = await signedGet<AccountInstrumentsPage>('/v5/account/instruments-info', params);
    const list = result?.list ?? [];
    all.push(...list);
    const next = result?.nextPageCursor;
    if (next == null || String(next).trim() === '') break;
    cursor = String(next);
  }
  return all;
}
