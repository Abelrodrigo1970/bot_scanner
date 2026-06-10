/**
 * Funções para buscar dados de mercado de APIs públicas
 */
import type { ProxyAgent as UndiciProxyAgent } from 'undici';

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

/** fapi1/2/3 devolvem HTTP 202 + corpo vazio (Railway US e muitas regiões) — só fapi.binance.com é fiável. */
const BINANCE_FAPI_HOSTS = ['https://fapi.binance.com'] as const;

const BINANCE_FAPI_RETRYABLE_STATUSES = new Set([202, 418, 429, 500, 502, 503, 504]);

function isRailwayHosted(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_REPLICA_ID
  );
}

/** Binance público (klines/tickers): omitir enquanto Bybit primário responde; senão fallback. */
function canAttemptBinancePublicApi(): boolean {
  if (binanceGeoBlocked) {
    if (bybitMarketDataGeoBlocked && Date.now() - binanceGeoBlockedAt >= BINANCE_GEO_BLOCK_RESET_MS) {
      resetBinanceGeoBlock();
    } else {
      return false;
    }
  }
  if (isBybitMarketDataPrimary() && canUseBybitMarketData()) return false;
  return true;
}

function isBinanceKlinesApiPath(path: string): boolean {
  return /\/klines\b/i.test(path);
}

/**
 * Railway: Bybit.nl directo (recomendado). Binance costuma 451 ou exige proxy pago.
 * Local/EU: Binance por defeito. Forçar: MARKET_DATA_PRIMARY=binance|bybit.
 */
function isBybitMarketDataPrimary(): boolean {
  const primary = (process.env.MARKET_DATA_PRIMARY ?? '').trim().toLowerCase();
  if (primary === 'bybit') return true;
  if (primary === 'binance') return false;
  if (process.env.MARKET_DATA_BYBIT_PRIMARY === 'true') return true;
  if (isRailwayHosted()) return true;
  return false;
}

function isBinanceMarketUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('binance.com') || host.includes('binance.vision');
  } catch {
    return /binance\.com/i.test(url);
  }
}

function isBybitMarketUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('bybit') || host.includes('bytick');
  } catch {
    return /bybit|bytick/i.test(url);
  }
}

/** Hosts públicos Bybit (market data). Railway US bloqueia api.bybit.com — tentar mirrors. */
function getBybitMarketDataHosts(): string[] {
  const explicit = process.env.BYBIT_MARKET_DATA_BASE_URL?.replace(/\/$/, '');
  const railwayDefault = isRailwayHosted() ? 'https://api.bybit.nl' : undefined;
  const preferred = explicit || railwayDefault;
  return [
    ...(preferred ? [preferred] : []),
    'https://api.bybit.nl',
    'https://api.bytick.com',
    'https://api.bybit.com',
  ].filter((h, i, a) => h && a.indexOf(h) === i);
}

let marketDataPrimaryLogged = false;
function logMarketDataPrimaryOnce(): void {
  if (marketDataPrimaryLogged || !isBybitMarketDataPrimary()) return;
  marketDataPrimaryLogged = true;
  const host = getBybitMarketDataHosts()[0] ?? 'api.bybit.nl';
  console.log(
    `ℹ️ Market data: Bybit primário (${host}); Binance entra se Bybit falhar.`
  );
}

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
/** Espaço mínimo entre pedidos Binance (cron analisa muitos símbolos; vários jobs em paralelo). */
const BINANCE_KLINES_MIN_GAP_MS = 500;
const BYBIT_KLINES_MIN_GAP_MS = 100;
/** Fila global: evita rajadas quando run-15m + run-1h + run-30m correm ao mesmo tempo. */
let binancePublicApiChain: Promise<unknown> = Promise.resolve();
let bybitPublicApiChain: Promise<unknown> = Promise.resolve();
/** Bybit public API devolve 403 (CloudFront geo) no Railway US — desactivar após todos os hosts falharem. */
let bybitMarketDataGeoBlocked = false;
let bybitGeoBlockedAt = 0;
let bybitGeoBlockWarned = false;
const bybitMarketDataHostsBlocked = new Set<string>();
const BYBIT_GEO_BLOCK_RESET_MS = 10 * 60 * 1000;
/** Após Binance 451 no Railway, preferir Bybit e re-tentar hosts (incidentes de rede são transitórios). */
let sessionPreferBybitAfter451 = false;
/** Binance HTTP 451 = geo-block neste IP — re-tenta após TTL se Bybit também falhar. */
let binanceGeoBlocked = false;
let binanceGeoBlockedAt = 0;
let binanceGeoBlockWarned = false;
let binance451PerSymbolLogs = 0;
const BINANCE_GEO_BLOCK_RESET_MS = 10 * 60 * 1000;
let marketDataConfigLogged = false;
let bybitFallbackToBinanceWarned = false;

let _proxyAgent: UndiciProxyAgent | null | undefined = undefined;
let _proxyDisabledForSession = false;
let _proxyDisabledWarned = false;

function flattenErrorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const code = (cur as Error & { code?: string }).code;
      if (code) parts.push(code);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(' ');
}

function isProxyTunnelError(err: unknown): boolean {
  const text = flattenErrorText(err);
  return /402|Proxy response|HTTP Tunneling|UND_ERR_ABORTED/i.test(text);
}

function isConnectTimeoutError(err: unknown): boolean {
  const text = flattenErrorText(err);
  return /UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(text);
}

function disableMarketDataProxyForSession(reason: string): void {
  if (_proxyDisabledForSession) return;
  _proxyDisabledForSession = true;
  _proxyAgent = null;
  sessionPreferBybitAfter451 = true;
  resetBybitMarketDataGeoBlock();
  if (!_proxyDisabledWarned) {
    _proxyDisabledWarned = true;
    console.warn(
      `⚠️ MARKET_DATA_PROXY_URL desactivado nesta sessão (${reason}). Bybit directo; Binance só se acessível. Remova a variável no Railway se o proxy expirou (402).`
    );
  }
}

function shouldRouteUrlThroughMarketDataProxy(url: string): boolean {
  if (_proxyDisabledForSession) return false;
  if (!process.env.MARKET_DATA_PROXY_URL?.trim()) return false;
  if (isBybitMarketUrl(url)) return false;
  if (isBinanceMarketUrl(url)) return true;
  return false;
}

async function getProxyAgent(): Promise<UndiciProxyAgent | null> {
  if (_proxyDisabledForSession) return null;
  const proxyUrl = process.env.MARKET_DATA_PROXY_URL?.trim();
  if (!proxyUrl) return null;
  if (_proxyAgent !== undefined) return _proxyAgent;
  try {
    const { ProxyAgent } = await import('undici');
    _proxyAgent = new ProxyAgent(proxyUrl);
    console.log(`ℹ️ Market data: proxy activo → ${proxyUrl.replace(/:([^@/]+)@/, ':***@')}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('markAsUncloneable')) {
      console.warn('⚠️ MARKET_DATA_PROXY_URL definido mas undici não disponível:', msg);
    }
    _proxyAgent = null;
  }
  return _proxyAgent;
}

async function proxyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!shouldRouteUrlThroughMarketDataProxy(url)) {
    return fetch(url, init);
  }
  const agent = await getProxyAgent();
  if (!agent) return fetch(url, init);
  try {
    const { fetch: undiciFetch } = await import('undici');
    return undiciFetch(url, { ...init, dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  } catch (err) {
    if (isProxyTunnelError(err)) {
      disableMarketDataProxyForSession('proxy 402 / túnel HTTP falhou');
      return fetch(url, init);
    }
    throw err;
  }
}

function binanceHttpFetch(url: string, timeoutMs = BINANCE_KLINES_TIMEOUT_MS): Promise<Response> {
  const init: RequestInit = {
    cache: 'no-store',
    headers: BINANCE_PUBLIC_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  };
  return proxyFetch(url, init);
}

function httpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return proxyFetch(url, init);
}

function resetBybitMarketDataGeoBlock(): void {
  bybitMarketDataGeoBlocked = false;
  bybitGeoBlockedAt = 0;
  bybitMarketDataHostsBlocked.clear();
  bybitGeoBlockWarned = false;
}

function logMarketDataConfigOnce(): void {
  if (marketDataConfigLogged) return;
  marketDataConfigLogged = true;
  const primary = (process.env.MARKET_DATA_PRIMARY ?? '(auto: binance)').trim() || '(auto: binance)';
  const bybitHost = getBybitMarketDataHosts()[0] ?? 'api.bybit.nl';
  const fallbackOff = process.env.BYBIT_MARKET_DATA_FALLBACK === 'false';
  console.log(
    `ℹ️ Market data: primary=${primary}, Bybit host=${bybitHost}, fallback=${fallbackOff ? 'OFF' : 'on'}, railway=${isRailwayHosted()}`
  );
  if (isRailwayHosted() && fallbackOff) {
    console.warn(
      '⚠️ BYBIT_MARKET_DATA_FALLBACK=false — sem fallback quando Binance devolve 451. Remova ou defina MARKET_DATA_PRIMARY=bybit.'
    );
  }
  const explicitBybit = process.env.BYBIT_MARKET_DATA_BASE_URL?.replace(/\/$/, '');
  if (isRailwayHosted() && explicitBybit?.includes('api.bybit.com') && !explicitBybit.includes('.nl')) {
    console.warn(
      '⚠️ BYBIT_MARKET_DATA_BASE_URL aponta para api.bybit.com (403 no Railway). Use https://api.bybit.nl'
    );
  }
}

function resetBinanceGeoBlock(): void {
  binanceGeoBlocked = false;
  binanceGeoBlockedAt = 0;
  binanceGeoBlockWarned = false;
  binance451PerSymbolLogs = 0;
}

function warnBybitFallbackToBinanceOnce(): void {
  if (bybitFallbackToBinanceWarned) return;
  bybitFallbackToBinanceWarned = true;
  console.warn('⚠️ Bybit market data falhou (403) — fallback Binance para velas/tickers.');
}

function markBinanceGeoBlocked(): void {
  binanceGeoBlocked = true;
  binanceGeoBlockedAt = Date.now();
  if (isRailwayHosted()) {
    sessionPreferBybitAfter451 = true;
    resetBybitMarketDataGeoBlock();
  }
  if (!binanceGeoBlockWarned) {
    console.warn(
      '⚠️ Binance geo-block (451) neste servidor; a usar Bybit para klines. ' +
        'Railway: MARKET_DATA_PRIMARY=bybit + BYBIT_MARKET_DATA_BASE_URL=https://api.bybit.nl'
    );
    binanceGeoBlockWarned = true;
  }
}

function binance451Error(path: string): Error & { status: number; retryable: boolean } {
  markBinanceGeoBlocked();
  const err = new Error(`Binance ${path}: 451`) as Error & { status: number; retryable: boolean };
  err.status = 451;
  err.retryable = true;
  return err;
}

const BINANCE_PUBLIC_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; bot_cripto-cron/1.0; +https://github.com/Abelrodrigo1970/bot_cripto)',
};

const BINANCE_KLINES_TIMEOUT_MS = 25_000;

function retryDelayMs(status: number, attempt: number, retryAfterHeader?: string | null): number {
  if (status === 429 || status === 418) {
    const parsed = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
    return Math.min(10_000, 1000 * 2 ** attempt);
  }
  return 400 * (attempt + 1);
}

function runOnThrottledQueue<T>(
  chainRef: { current: Promise<unknown> },
  lastAtRef: { value: number },
  gapMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const task = chainRef.current.then(async () => {
    const waitMs = lastAtRef.value + gapMs - Date.now();
    if (waitMs > 0) await delay(waitMs);
    lastAtRef.value = Date.now();
    return fn();
  });
  chainRef.current = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

const binanceQueueRef = { current: binancePublicApiChain };
const bybitQueueRef = { current: bybitPublicApiChain };
const binanceLastAtRef = { value: 0 };
const bybitLastAtRef = { value: 0 };

function runOnBinanceQueue<T>(fn: () => Promise<T>): Promise<T> {
  return runOnThrottledQueue(binanceQueueRef, binanceLastAtRef, BINANCE_KLINES_MIN_GAP_MS, fn);
}

function runOnBybitQueue<T>(fn: () => Promise<T>): Promise<T> {
  return runOnThrottledQueue(bybitQueueRef, bybitLastAtRef, BYBIT_KLINES_MIN_GAP_MS, fn);
}

function noteBybitGeoBlock(err: unknown, host?: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (host && (msg.includes('403') || msg.includes('CloudFront'))) {
    bybitMarketDataHostsBlocked.add(host);
  }
  if (
    msg.includes('403') ||
    msg.includes('CloudFront') ||
    msg.includes('block access from your country')
  ) {
    if (host) bybitMarketDataHostsBlocked.add(host);
    if (bybitMarketDataHostsBlocked.size >= getBybitMarketDataHosts().length) {
      bybitMarketDataGeoBlocked = true;
      bybitGeoBlockedAt = Date.now();
      if (!bybitGeoBlockWarned) {
        console.warn(
          '⚠️ Bybit market data indisponível neste servidor (403 em todos os hosts). ' +
            'Re-tenta em 10 min. Railway: BYBIT_MARKET_DATA_BASE_URL=https://api.bybit.nl'
        );
        bybitGeoBlockWarned = true;
      }
    }
  }
}

function canUseBybitMarketData(): boolean {
  if (bybitMarketDataGeoBlocked) {
    if (Date.now() - bybitGeoBlockedAt >= BYBIT_GEO_BLOCK_RESET_MS) {
      resetBybitMarketDataGeoBlock();
    } else {
      return false;
    }
  }
  if (process.env.BYBIT_MARKET_DATA_FALLBACK === 'false') return false;
  return true;
}

/** HTTP 202 Accepted com corpo vazio — mirrors fapi1/2/3; tratar como falha retryable. */
function isBinanceEmptyBody(status: number, bodyText: string): boolean {
  return !bodyText.trim() || status === 202;
}

/** GET Binance Futures público com fila global, mirrors e retry. */
async function fetchBinanceFapiText(path: string): Promise<string> {
  const normalized = path.startsWith('/') ? path : `/${path}`;

  if (!canAttemptBinancePublicApi()) {
    if (binanceGeoBlocked) {
      throw binance451Error(normalized);
    }
    const err = new Error(
      `Binance ${normalized}: omitido (Bybit é a fonte primária; defina MARKET_DATA_PRIMARY=binance só em servidor EU)`
    ) as Error & { status: number; retryable: boolean };
    err.status = 451;
    err.retryable = false;
    throw err;
  }

  const hostCount = BINANCE_FAPI_HOSTS.length;
  const maxAttempts = Math.max(8, hostCount * 6);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const host = BINANCE_FAPI_HOSTS[attempt % hostCount];
    const url = `${host}${normalized}`;

    try {
      const response = await runOnBinanceQueue(() => binanceHttpFetch(url));
      const bodyText = await response.text();

      if (response.status === 451) {
        throw binance451Error(normalized);
      }

      if (!response.ok) {
        const error: Error & { status?: number; retryable?: boolean } = new Error(
          `Binance ${normalized}: ${response.status} ${response.statusText}`
        );
        error.status = response.status;
        error.retryable = BINANCE_FAPI_RETRYABLE_STATUSES.has(response.status);
        if (!error.retryable) throw error;
        lastError = error;
        await delay(
          retryDelayMs(response.status, attempt, response.headers.get('retry-after'))
        );
        continue;
      }

      if (isBinanceEmptyBody(response.status, bodyText)) {
        const error: Error & { status?: number; retryable?: boolean } = new Error(
          `Resposta vazia Binance ${normalized} @ ${host} (HTTP ${response.status})`
        );
        error.status = response.status === 202 ? 202 : undefined;
        error.retryable = true;
        lastError = error;
        await delay(retryDelayMs(response.status === 202 ? 429 : 0, attempt));
        continue;
      }
      return bodyText.trim();
    } catch (err) {
      lastError = err;
      if ((err as { status?: number })?.status === 451) break;
      if (!isRetryableKlinesError(err) || attempt === maxAttempts - 1) break;
      const status = (err as { status?: number })?.status;
      await delay(retryDelayMs(status ?? 0, attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Binance ${normalized} falhou`);
}

type UsdtPerpTicker24hr = {
  symbol: string;
  quoteVolume: string;
  priceChangePercent?: string;
  lastPrice?: string;
  volume?: string;
};

async function fetchBybitLinearTickers24hr(): Promise<UsdtPerpTicker24hr[]> {
  const bodyText = await fetchBybitMarketText('/v5/market/tickers?category=linear');
  const parsed = JSON.parse(bodyText) as {
    result?: {
      list?: Array<{
        symbol?: string;
        turnover24h?: string;
        volume24h?: string;
        price24hPcnt?: string;
        lastPrice?: string;
      }>;
    };
  };
  const tickers = (parsed.result?.list ?? [])
    .filter((t) => t.symbol?.endsWith('USDT') && !t.symbol?.includes('BUSD'))
    .map((t) => ({
      symbol: t.symbol!,
      quoteVolume: t.turnover24h || t.volume24h || '0',
      priceChangePercent: t.price24hPcnt || '0',
      lastPrice: t.lastPrice || '0',
      volume: t.volume24h || '0',
    }));
  rememberBybitLinearSymbols(tickers.map((t) => t.symbol));
  return tickers;
}

/** Conjunto de símbolos linear USDT disponíveis na Bybit (cache curto para saltar pares inexistentes). */
let bybitLinearSymbolsCache: { set: Set<string>; at: number } | null = null;
const BYBIT_LINEAR_SYMBOLS_TTL_MS = 10 * 60 * 1000;

function rememberBybitLinearSymbols(symbols: string[]): void {
  if (symbols.length === 0) return;
  bybitLinearSymbolsCache = {
    set: new Set(symbols.map((s) => s.toUpperCase())),
    at: Date.now(),
  };
}

async function getBybitLinearSymbolSet(): Promise<Set<string> | null> {
  if (
    bybitLinearSymbolsCache &&
    Date.now() - bybitLinearSymbolsCache.at < BYBIT_LINEAR_SYMBOLS_TTL_MS
  ) {
    return bybitLinearSymbolsCache.set;
  }
  try {
    await fetchBybitLinearTickers24hr();
  } catch {
    // mantém cache anterior se existir
  }
  return bybitLinearSymbolsCache?.set ?? null;
}

/**
 * Quando a Bybit é a fonte primária (Railway), remove símbolos que não existem na Bybit linear.
 * Útil para limpar universos persistidos com símbolos só-Binance. Em caso de dúvida, mantém o símbolo.
 */
export async function filterToBybitMarketSymbols(symbols: string[]): Promise<string[]> {
  if (!isBybitMarketDataPrimary() || symbols.length === 0) return symbols;
  const set = await getBybitLinearSymbolSet();
  if (!set || set.size === 0) return symbols;
  return symbols.filter((s) => set.has(s.toUpperCase()));
}

async function fetchUsdtPerpTickers24hr(): Promise<UsdtPerpTicker24hr[]> {
  if (shouldUseBybitMarketData()) {
    try {
      return await fetchBybitLinearTickers24hr();
    } catch (bybitErr) {
      noteBybitGeoBlock(bybitErr);
      if (isBybitMarketDataPrimary()) {
        warnBybitFallbackToBinanceOnce();
      }
    }
  }
  if (!canAttemptBinancePublicApi()) {
    throw new Error('Tickers 24h: Bybit e Binance indisponíveis neste servidor');
  }
  return JSON.parse(
    await fetchBinanceFapiText('/fapi/v1/ticker/24hr')
  ) as UsdtPerpTicker24hr[];
}

function topUsdtSymbolsByQuoteVolume(
  tickers: UsdtPerpTicker24hr[],
  pool: number,
  minQuoteVolume: number
): string[] {
  return tickers
    .filter(
      (t) =>
        t.symbol.endsWith('USDT') &&
        !t.symbol.includes('BUSD') &&
        parseFloat(t.quoteVolume || '0') > minQuoteVolume
    )
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, pool)
    .map((t) => t.symbol);
}

async function fetchBinanceFapiJson<T>(path: string): Promise<T> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === '/fapi/v1/ticker/24hr' && isBybitMarketDataPrimary() && canUseBybitMarketData()) {
    try {
      return (await fetchBybitLinearTickers24hr()) as T;
    } catch (bybitErr) {
      noteBybitGeoBlock(bybitErr);
    }
  }
  return JSON.parse(await fetchBinanceFapiText(path)) as T;
}

function isRetryableKlinesError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { retryable?: boolean; status?: number; name?: string };
  if (e.status === 451) return false;
  if (e.retryable === true) return true;
  if (e.status != null && BINANCE_FAPI_RETRYABLE_STATUSES.has(e.status)) return true;
  if (e.name === 'SyntaxError') return true;
  if (e.name === 'TypeError') return true;
  if (e.name === 'AbortError') return true;
  return false;
}

/** GET Bybit market data (público) — tenta vários hosts antes de desistir. */
async function fetchBybitMarketText(pathAndQuery: string): Promise<string> {
  let lastError: unknown;

  for (const host of getBybitMarketDataHosts()) {
    if (bybitMarketDataHostsBlocked.has(host)) continue;

    const url = `${host}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;

    try {
      const response = await runOnBybitQueue(() =>
        httpFetch(url, {
          cache: 'no-store',
          headers: BINANCE_PUBLIC_HEADERS,
          signal: AbortSignal.timeout(BINANCE_KLINES_TIMEOUT_MS),
        })
      );
      const bodyText = await response.text();

      if (!response.ok) {
        if (response.status === 403) {
          noteBybitGeoBlock(
            new Error(`Bybit ${pathAndQuery}: 403 — ${bodyText.slice(0, 120)}`),
            host
          );
        }
        throw new Error(
          `Bybit ${pathAndQuery}: ${response.status} ${response.statusText} — ${bodyText.slice(0, 120)}`
        );
      }

      const trimmed = bodyText.trim();
      if (!trimmed) throw new Error(`Bybit resposta vazia ${pathAndQuery} @ ${host}`);
      return trimmed;
    } catch (err) {
      lastError = err;
      noteBybitGeoBlock(err, host);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Bybit ${pathAndQuery} falhou`);
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

  const params = new URLSearchParams({
    category: 'linear',
    symbol: symbol.toUpperCase(),
    interval: bybitInterval,
    limit: String(Math.min(Math.max(1, limit), 1000)),
  });
  if (startTime) params.set('start', String(startTime));
  if (endTime) params.set('end', String(endTime));

  const bodyText = await fetchBybitMarketText(`/v5/market/kline?${params}`);
  const parsed = JSON.parse(bodyText) as { result?: { list?: string[][] } };
  const rows = parsed.result?.list ?? [];
  if (rows.length === 0) {
    const err = new Error(`Bybit klines vazio para ${symbol}`) as Error & {
      symbolUnavailable: boolean;
    };
    err.symbolUnavailable = true;
    throw err;
  }

  let candles = parseBybitKlineRows(rows);
  if (startTime) candles = candles.filter((c) => c.timestamp >= startTime);
  if (endTime) candles = candles.filter((c) => c.timestamp <= endTime);
  if (candles.length > limit) candles = candles.slice(-limit);
  return candles;
}

async function fetchCurrentPriceFromBybit(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  const bodyText = await fetchBybitMarketText(
    `/v5/market/tickers?category=linear&symbol=${sym}`
  );
  const parsed = JSON.parse(bodyText) as {
    result?: { list?: Array<{ lastPrice?: string }> };
  };
  const price = parseFloat(parsed.result?.list?.[0]?.lastPrice ?? '');
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Preço Bybit inválido para ${sym}`);
  }
  return price;
}

function shouldUseBybitMarketData(err?: unknown): boolean {
  if (process.env.BYBIT_MARKET_DATA_FALLBACK === 'false' && !isBybitMarketDataPrimary()) {
    return false;
  }
  if (isBybitMarketDataPrimary()) {
    return canUseBybitMarketData();
  }
  if (sessionPreferBybitAfter451 && canUseBybitMarketData()) return true;
  if (!canUseBybitMarketData()) return false;
  if (binanceGeoBlocked) return true;
  if (_proxyDisabledForSession && isRailwayHosted()) return true;
  if (err) {
    if (isProxyTunnelError(err) || isConnectTimeoutError(err)) return true;
    if (typeof err === 'object' && (err as { status?: number }).status === 451) return true;
  }
  return false;
}

function marketDataBlockedMessage(): string {
  if (process.env.BYBIT_MARKET_DATA_FALLBACK === 'false') {
    return 'Binance bloqueada (451) e BYBIT_MARKET_DATA_FALLBACK=false — defina MARKET_DATA_PRIMARY=bybit';
  }
  if (bybitMarketDataGeoBlocked) {
    return 'Binance bloqueada (451) e Bybit indisponível (403 em todos os hosts) — use BYBIT_MARKET_DATA_BASE_URL=https://api.bybit.nl';
  }
  return 'Binance bloqueada (451) e fallback Bybit não activo';
}

function warnCandlesFetchFailure(symbol: string, interval: string, err: unknown): void {
  const status = (err as { status?: number })?.status;
  if (status === 451) {
    if (binance451PerSymbolLogs < 2) {
      console.warn(`⚠️ Binance candles ${symbol} (${interval}): geo-block 451`);
      binance451PerSymbolLogs++;
    } else if (binance451PerSymbolLogs === 2) {
      console.warn('⚠️ Binance 451 — avisos por símbolo suprimidos (usa Bybit/proxy/EU)');
      binance451PerSymbolLogs++;
    }
    return;
  }
  if (status === 429) {
    console.warn(`⚠️ Binance rate limit — candles ${symbol} (${interval}) ignorados nesta ronda`);
    return;
  }
  console.warn(`⚠️ Binance candles ${symbol} (${interval}):`, err);
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
  logMarketDataConfigOnce();
  logMarketDataPrimaryOnce();
  if (backtestCandleState) {
    const key = `${symbol.toUpperCase()}:${interval}`;
    const all = backtestCandleState.pools.get(key) ?? [];
    let filtered = all.filter((c) => c.timestamp <= backtestCandleState!.endMs);
    if (startTime) filtered = filtered.filter((c) => c.timestamp >= startTime);
    if (endTime) filtered = filtered.filter((c) => c.timestamp <= endTime);
    return filtered.slice(-Math.max(1, limit));
  }

  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (startTime) params.set('startTime', String(startTime));
  if (endTime) params.set('endTime', String(endTime));

  const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
  let lastError: unknown;

  if (shouldUseBybitMarketData() && bybitInterval) {
    if (isBybitMarketDataPrimary()) {
      const bybitSymbols = await getBybitLinearSymbolSet();
      if (bybitSymbols && !bybitSymbols.has(symbol.toUpperCase())) {
        return [];
      }
    }
    try {
      return await fetchCandlesFromBybit(symbol, interval, limit, startTime, endTime);
    } catch (bybitErr) {
      noteBybitGeoBlock(bybitErr);
      lastError = bybitErr;
      if ((bybitErr as { symbolUnavailable?: boolean })?.symbolUnavailable) {
        return [];
      }
      if (isBybitMarketDataPrimary()) {
        warnBybitFallbackToBinanceOnce();
      }
    }
  }

  if (!canAttemptBinancePublicApi()) {
    const msg =
      bybitMarketDataGeoBlocked && binanceGeoBlocked
        ? 'Bybit (403) e Binance (451) indisponíveis neste IP Railway'
        : bybitMarketDataGeoBlocked && isBybitMarketDataPrimary()
          ? 'Bybit indisponível (403) e Binance bloqueada (451) neste servidor'
          : marketDataBlockedMessage();
    const err = new Error(`${msg} — ${symbol} ${interval}`);
    warnCandlesFetchFailure(symbol, interval, lastError ?? err);
    throw lastError instanceof Error ? lastError : err;
  }

  try {
    const bodyText = await fetchBinanceFapiText(`/fapi/v1/klines?${params}`);
    return parseBinanceKlinesBody(bodyText, symbol, BINANCE_FAPI_HOSTS[0]);
  } catch (err) {
    lastError = err;
  }

  if (shouldUseBybitMarketData(lastError) && bybitInterval) {
    try {
      return await fetchCandlesFromBybit(symbol, interval, limit, startTime, endTime);
    } catch (bybitErr) {
      noteBybitGeoBlock(bybitErr);
      lastError = bybitErr;
    }
  }

  // 400 = símbolo inexistente/inválido na Binance (lixo de universos antigos ou
  // par só noutra exchange). Não há dados a obter: devolve vazio sem spam de erros.
  if ((lastError as { status?: number })?.status === 400) {
    return [];
  }

  warnCandlesFetchFailure(symbol, interval, lastError);
  throw lastError;
}

/**
 * Busca o preço actual de um par (Futures USDⓈ-M). Usa mirrors Binance como fetchCandles.
 */
export async function fetchCurrentPrice(symbol: string): Promise<number> {
  let lastError: unknown;

  if (shouldUseBybitMarketData()) {
    try {
      return await fetchCurrentPriceFromBybit(symbol);
    } catch (bybitErr) {
      noteBybitGeoBlock(bybitErr);
      lastError = bybitErr;
      if (isBybitMarketDataPrimary()) {
        warnBybitFallbackToBinanceOnce();
      }
    }
  }

  if (!canAttemptBinancePublicApi()) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`Preço ${symbol}: Bybit/Binance indisponíveis neste servidor`);
  }

  try {
    const bodyText = await fetchBinanceFapiText(
      `/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`
    );
    const data = JSON.parse(bodyText) as { price?: string };
    const price = parseFloat(data.price ?? '');
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Preço inválido para ${symbol}`);
    }
    return price;
  } catch (err) {
    lastError = err;
  }

  if (shouldUseBybitMarketData(lastError)) {
    try {
      return await fetchCurrentPriceFromBybit(symbol);
    } catch (bybitErr) {
      noteBybitGeoBlock(bybitErr);
      lastError = bybitErr;
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

/** Como {@link fetchCandles}, mas devolve null em falha (sem log). */
export async function fetchCandlesSafe(
  symbol: string,
  interval: string,
  limit: number = 200,
  startTime?: number,
  endTime?: number
): Promise<Candle[] | null> {
  try {
    return await fetchCandles(symbol, interval, limit, startTime, endTime);
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

  const candles = await fetchCandlesSafe(symbol, '1h', 3);
  const last = candles?.[candles.length - 1];
  if (last && last.close > 0) {
    return { price: last.close, source: 'klines' };
  }

  return { price: entryPrice, source: 'entry' };
}

/** Turnover USDT da última vela 1h fechada. Usa quote volume (Binance índice 7, Bybit turnover). */
export async function fetchLastClosed1hQuoteVolumeUsd(symbol: string): Promise<number | null> {
  const sym = symbol.toUpperCase();

  if (shouldUseBybitMarketData() && BYBIT_KLINE_INTERVAL['1h']) {
    try {
      const params = new URLSearchParams({
        category: 'linear',
        symbol: sym,
        interval: BYBIT_KLINE_INTERVAL['1h'],
        limit: '2',
      });
      const bodyText = await fetchBybitMarketText(`/v5/market/kline?${params}`);
      const parsed = JSON.parse(bodyText) as { result?: { list?: string[][] } };
      const rows = parsed.result?.list ?? [];
      if (rows.length >= 1) {
        const lastClosed = rows.length >= 2 ? rows[rows.length - 2]! : rows[rows.length - 1]!;
        const turnover = parseFloat(lastClosed[6] ?? '');
        if (Number.isFinite(turnover) && turnover > 0) return turnover;
      }
    } catch {
      // fallback Binance abaixo
    }
  }

  if (!canAttemptBinancePublicApi()) {
    return null;
  }

  try {
    const bodyText = await fetchBinanceFapiText(`/fapi/v1/klines?symbol=${sym}&interval=1h&limit=2`);
    const rows = JSON.parse(bodyText) as unknown[][];
    if (rows.length < 1) return null;
    const lastClosed = rows.length >= 2 ? rows[rows.length - 2]! : rows[rows.length - 1]!;
    const quoteVol = parseFloat(String(lastClosed[7] ?? ''));
    return Number.isFinite(quoteVol) && quoteVol > 0 ? quoteVol : null;
  } catch {
    return null;
  }
}

/** Garante velas em ordem cronológica (Bybit devolve mais recente primeiro). */
function klineRowsChronological(rows: string[][]): string[][] {
  if (rows.length <= 1) return rows;
  const t0 = Number(rows[0]![0]);
  const t1 = Number(rows[rows.length - 1]![0]);
  if (Number.isFinite(t0) && Number.isFinite(t1) && t0 > t1) {
    return rows.slice().reverse();
  }
  return rows;
}

/** Soma do turnover USDT das últimas 3 velas 1h fechadas (Binance quote vol / Bybit turnover). */
export async function fetchLast3Closed1hQuoteVolumeUsdSum(symbol: string): Promise<number | null> {
  const sym = symbol.toUpperCase();
  const CLOSED_COUNT = 3;

  const sumFromRows = (rows: string[][], turnoverIdx: number): number | null => {
    const ordered = klineRowsChronological(rows);
    if (ordered.length < CLOSED_COUNT + 1) return null;
    const closed = ordered.slice(ordered.length - CLOSED_COUNT - 1, ordered.length - 1);
    let sum = 0;
    for (const row of closed) {
      const turnover = parseFloat(String(row[turnoverIdx] ?? ''));
      if (!Number.isFinite(turnover) || turnover <= 0) return null;
      sum += turnover;
    }
    return sum;
  };

  if (shouldUseBybitMarketData() && BYBIT_KLINE_INTERVAL['1h']) {
    try {
      const params = new URLSearchParams({
        category: 'linear',
        symbol: sym,
        interval: BYBIT_KLINE_INTERVAL['1h'],
        limit: String(CLOSED_COUNT + 2),
      });
      const bodyText = await fetchBybitMarketText(`/v5/market/kline?${params}`);
      const parsed = JSON.parse(bodyText) as { result?: { list?: string[][] } };
      const sum = sumFromRows(parsed.result?.list ?? [], 6);
      if (sum != null) return sum;
    } catch {
      // fallback Binance abaixo
    }
  }

  if (!canAttemptBinancePublicApi()) {
    return null;
  }

  try {
    const bodyText = await fetchBinanceFapiText(
      `/fapi/v1/klines?symbol=${sym}&interval=1h&limit=${CLOSED_COUNT + 2}`
    );
    const rows = JSON.parse(bodyText) as unknown[][];
    const asStrings = rows.map((r) => r.map((c) => String(c)));
    return sumFromRows(asStrings, 7);
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
    const data = await fetchUsdtPerpTickers24hr();
    const usdtPairs = data
      .filter((ticker) => parseFloat(ticker.quoteVolume) > 1_000_000)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 50);

    const topMoversData = await Promise.all(
      usdtPairs.map(async (ticker) => {
        try {
          const candles = await fetchCandles(ticker.symbol, '1d', 1);
          if (candles.length === 0) return null;

          const todayCandle = candles[candles.length - 1]!;
          const openPrice = todayCandle.open;
          const currentPrice = parseFloat(ticker.lastPrice || '0');
          const highPrice = todayCandle.high;
          const lowPrice = todayCandle.low;
          const priceChangePercent = ((currentPrice - openPrice) / openPrice) * 100;

          return {
            symbol: ticker.symbol,
            priceChangePercent,
            lastPrice: currentPrice,
            volume: parseFloat(ticker.volume || '0'),
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
    const data = await fetchBinanceFapiJson<
      Array<{ symbol: string; quoteVolume: string }>
    >('/fapi/v1/ticker/24hr');

    const usdtPairs = data
      .filter((ticker) => {
        return (
          ticker.symbol.endsWith('USDT') &&
          !ticker.symbol.includes('BUSD') &&
          parseFloat(ticker.quoteVolume) >= minQuoteVolume
        );
      })
      .map((ticker) => ({
        symbol: ticker.symbol,
        quoteVolume: parseFloat(ticker.quoteVolume),
      }));

    const sorted = usdtPairs.sort((a, b) => b.quoteVolume - a.quoteVolume);
    return sorted.slice(0, limit).map((item) => item.symbol);
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
    const data = await fetchBinanceFapiJson<
      Array<{ symbol: string; quoteVolume: string; priceChangePercent: string }>
    >('/fapi/v1/ticker/24hr');

    const usdtPairs = data
      .filter((ticker) => {
        return (
          ticker.symbol.endsWith('USDT') &&
          !ticker.symbol.includes('BUSD') &&
          parseFloat(ticker.quoteVolume) >= minQuoteVolume
        );
      })
      .map((ticker) => ({
        symbol: ticker.symbol,
        priceChangePercent: parseFloat(ticker.priceChangePercent || '0'),
      }));

    const sorted = usdtPairs.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    return sorted.slice(0, limit).map((item) => item.symbol);
  } catch (error) {
    console.error('Erro ao buscar top símbolos por % 24h:', error);
    throw error;
  }
}

/**
 * Busca os símbolos com maior variação de preço na última hora (1h).
 * Candidatos: top liquidez (ticker/24hr, 1 pedido). Klines 1h via fila global (fetchCandles).
 */
export async function fetchTopSymbolsBy1hPriceChange(
  limit: number = 150,
  candidatePool: number = 60
): Promise<string[]> {
  try {
    const tickers = await fetchBinanceFapiJson<
      Array<{ symbol: string; quoteVolume: string }>
    >('/fapi/v1/ticker/24hr');

    const usdtPairs = tickers
      .filter(
        (t) =>
          t.symbol.endsWith('USDT') &&
          !t.symbol.includes('BUSD') &&
          parseFloat(t.quoteVolume) > 100_000
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, candidatePool)
      .map((t) => t.symbol);

    const results: { symbol: string; changePercent1h: number }[] = [];

    for (const symbol of usdtPairs) {
      try {
        const klines = await fetchCandles(symbol, '1h', 2);
        if (klines.length < 2) continue;
        const prevClose = klines[0]!.close;
        const lastClose = klines[1]!.close;
        if (prevClose <= 0) continue;
        results.push({
          symbol,
          changePercent1h: ((lastClose - prevClose) / prevClose) * 100,
        });
      } catch {
        // ignora falha por símbolo
      }
    }

    results.sort((a, b) => b.changePercent1h - a.changePercent1h);
    return results.slice(0, limit).map((r) => r.symbol);
  } catch (error) {
    console.warn('Erro ao buscar símbolos por variação 1h:', error);
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
    const tickerData = await fetchUsdtPerpTickers24hr();
    const symbols = topUsdtSymbolsByQuoteVolume(tickerData, 300, 500_000);

    const results: Omit<MaCrossBelowItem, 'rank'>[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klines = await fetchCandles(symbol, '1h', 205);
        if (klines.length < 202) continue;

        const closes: number[] = klines.slice(0, -1).map((k) => k.close);
        const lastPrice = closes[closes.length - 1]!;

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
    const tickerData = await fetchUsdtPerpTickers24hr();
    const symbols = topUsdtSymbolsByQuoteVolume(tickerData, 300, 500_000);

    const results: Omit<MaCrossBelowItem, 'rank'>[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klines = await fetchCandles(symbol, '1h', 205);
        if (klines.length < 202) continue;

        const closes: number[] = klines.slice(0, -1).map((k) => k.close);
        const lastPrice = closes[closes.length - 1]!;

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
    const tickerData = await fetchUsdtPerpTickers24hr();
    const symbols = topUsdtSymbolsByQuoteVolume(tickerData, 300, 500_000);

    const results: Omit<MaCrossBelowItem, 'rank'>[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klines = await fetchCandles(symbol, '1h', 205);
        if (klines.length < 202) continue;

        const closes: number[] = klines.slice(0, -1).map((k) => k.close);
        const lastPrice = closes[closes.length - 1]!;

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
    const path = `/v5/market/instruments-info?category=${category}&limit=1000${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    }`;
    const bodyText = await fetchBybitMarketText(path);
    const json = JSON.parse(bodyText) as {
      retCode?: number;
      retMsg?: string;
      result?: { list?: BybitInstrumentPublicRow[]; nextPageCursor?: string };
    };
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
    const tickerData = await fetchUsdtPerpTickers24hr();
    const symbols = topUsdtSymbolsByQuoteVolume(tickerData, 200, 500_000);

    const results: { symbol: string; high3m: number; low3m: number; volatilityPercent: number; lastPrice: number }[] = [];
    const scanStart = Date.now() - TOP_VOLATILE_SCAN_MS;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        const klines = await fetchCandles(symbol, '1d', 100, scanStart);
        if (klines.length < 7) continue;

        let high3m = -Infinity;
        let low3m = Infinity;
        for (const k of klines) {
          if (k.high > high3m) high3m = k.high;
          if (k.low < low3m && k.low > 0) low3m = k.low;
        }
        if (low3m <= 0 || !isFinite(high3m)) continue;

        const volatilityPercent = ((high3m - low3m) / low3m) * 100;
        const lastPrice = klines[klines.length - 1]!.close;

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
