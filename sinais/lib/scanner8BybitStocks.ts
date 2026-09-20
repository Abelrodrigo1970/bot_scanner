/**
 * Scanner 8 — Bybit TradFi stock perpetuals (symbolType=stock).
 * Colunas: % 24h, % 1 semana, EMA21 / EMA70 (diário), link TradingView.
 */

import { calculateLastEMA } from '@/lib/indicators';
import {
  fetchBybitInstrumentsInfoAllPages,
  parseBybitTradfiSymbolUniverse,
} from '@/lib/marketData';

export const SCANNER_8_CACHE_KEY = 'SCANNER_8_BYBIT_STOCKS_LAST' as const;
export const SCANNER_8_UNIVERSE_CODE = 'UNIVERSE_BYBIT_STOCKS_1D' as const;

export type Scanner8Row = {
  rank: number;
  symbol: string;
  baseAsset: string;
  close: number;
  change24hPct: number | null;
  change1wPct: number | null;
  ema21: number | null;
  ema70: number | null;
  pctFromEma21: number | null;
  pctFromEma70: number | null;
  tradingViewUrl: string;
};

export type Scanner8Result = {
  scannedAt: string;
  source: string;
  count: number;
  items: Scanner8Row[];
};

const BATCH = 8;
const KLINE_LIMIT = 120;

function tradingViewBybitPerpUrl(symbol: string): string {
  const base = symbol.replace(/\.P$/i, '').toUpperCase();
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BYBIT:${base}.P`)}`;
}

function pctChange(from: number, to: number): number | null {
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

function pctFromMa(close: number, ma: number | null): number | null {
  if (ma == null || !(ma > 0) || !Number.isFinite(close)) return null;
  return ((close - ma) / ma) * 100;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** Mapa símbolo → variação 24h % (Bybit ticker price24hPcnt). */
async function fetchLinearTickerChange24hMap(): Promise<Map<string, number>> {
  const json = (await fetchJson(
    'https://api.bybit.com/v5/market/tickers?category=linear'
  )) as {
    retCode?: number;
    result?: { list?: Array<{ symbol?: string; price24hPcnt?: string; lastPrice?: string }> };
  };
  if (json.retCode !== 0) return new Map();
  const map = new Map<string, number>();
  for (const t of json.result?.list ?? []) {
    const sym = String(t.symbol ?? '');
    if (!sym) continue;
    const raw = Number(t.price24hPcnt);
    if (Number.isFinite(raw)) map.set(sym, raw * 100);
  }
  return map;
}

async function fetchDailyClosedCloses(
  symbol: string
): Promise<number[]> {
  const json = (await fetchJson(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=D&limit=${KLINE_LIMIT}`
  )) as {
    retCode?: number;
    result?: { list?: string[][] };
  };
  if (json.retCode !== 0) return [];
  const raw = json.result?.list ?? [];
  // Bybit: newest first → reverse to oldest first
  const ascending = raw.slice().reverse();
  const closes = ascending
    .map((k) => parseFloat(k[4]))
    .filter((n) => Number.isFinite(n) && n > 0);
  // Drop forming candle (last incomplete day)
  if (closes.length < 2) return closes;
  return closes.slice(0, -1);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Lista Bybit linear `symbolType=stock` (Trading) com métricas diárias.
 * Ordenação default: % 24h descendente.
 */
export async function runScanner8BybitStocks(options?: {
  source?: string;
}): Promise<Scanner8Result> {
  const source = options?.source ?? 'scanner8';
  const linearList = await fetchBybitInstrumentsInfoAllPages('linear');
  const { linearStocks } = parseBybitTradfiSymbolUniverse(linearList, []);
  const trading = linearStocks.filter((e) => e.status === 'Trading');

  const change24hMap = await fetchLinearTickerChange24hMap();

  type PartialRow = Omit<Scanner8Row, 'rank'>;
  const partials = await mapPool(trading, BATCH, async (entry) => {
    try {
      const closes = await fetchDailyClosedCloses(entry.symbol);
      if (closes.length < 2) return null;

      const close = closes[closes.length - 1];
      const close1wAgo =
        closes.length >= 8 ? closes[closes.length - 8] : closes[0];
      const ema21 = calculateLastEMA(closes, 21);
      const ema70 = calculateLastEMA(closes, 70);
      const change24hPct = change24hMap.has(entry.symbol)
        ? change24hMap.get(entry.symbol)!
        : closes.length >= 2
          ? pctChange(closes[closes.length - 2], close)
          : null;

      const row: PartialRow = {
        symbol: entry.symbol,
        baseAsset: entry.baseAsset,
        close,
        change24hPct,
        change1wPct: pctChange(close1wAgo, close),
        ema21,
        ema70,
        pctFromEma21: pctFromMa(close, ema21),
        pctFromEma70: pctFromMa(close, ema70),
        tradingViewUrl: tradingViewBybitPerpUrl(entry.symbol),
      };
      return row;
    } catch {
      return null;
    }
  });

  const items = partials
    .filter((r): r is PartialRow => r != null)
    .sort((a, b) => (b.change24hPct ?? -Infinity) - (a.change24hPct ?? -Infinity))
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    scannedAt: new Date().toISOString(),
    source,
    count: items.length,
    items,
  };
}
