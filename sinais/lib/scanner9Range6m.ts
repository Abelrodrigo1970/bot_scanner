/**
 * Scanner 9 — maior amplitude 6 meses (máxima vs mínima, velas 1D).
 * Universo: perps lineares USDT Bybit (cripto, Trading) com turnover 24h ≥ mínimo
 * e pelo menos ~6 meses de histórico diário. Top 30 por (máx / mín − 1).
 */

import { fetchBybitInstrumentsInfoAllPages } from '@/lib/marketData';

export const SCANNER_9_CACHE_KEY = 'SCANNER_9_RANGE_6M_LAST' as const;
export const SCANNER_9_UNIVERSE_CODE = 'UNIVERSE_RANGE_6M_1D' as const;

export const SCANNER_9_TOP_N = 30;
export const SCANNER_9_LOOKBACK_DAYS = 182;
/** Exige quase 6 meses de velas para não misturar listagens recentes. */
export const SCANNER_9_MIN_HISTORY_DAYS = 170;
export const SCANNER_9_MIN_TURNOVER_24H = 1_000_000;

export type Scanner9Row = {
  rank: number;
  symbol: string;
  baseAsset: string;
  price: number;
  high6m: number;
  high6mAt: string;
  low6m: number;
  low6mAt: string;
  /** (máx / mín − 1) × 100 */
  rangePct: number;
  /** (preço / máx − 1) × 100 — negativo = abaixo da máxima */
  pctFromHigh: number;
  /** (preço / mín − 1) × 100 */
  pctFromLow: number;
  /** Média dos fechos diários no período */
  avgClose6m: number;
  pctFromAvg: number;
  /** (máx + mín) / 2 */
  midRange: number;
  /** Posição do preço na amplitude: 0% = mínima, 100% = máxima */
  rangePositionPct: number;
  turnover24h: number;
  tradingViewUrl: string;
};

export type Scanner9Result = {
  scannedAt: string;
  source: string;
  lookbackDays: number;
  minTurnover24h: number;
  candidates: number;
  count: number;
  items: Scanner9Row[];
};

const BATCH = 8;
const KLINE_LIMIT = 200;
const DAY_MS = 86_400_000;

function tradingViewBybitPerpUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BYBIT:${symbol.toUpperCase()}.P`)}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

type Ticker = { lastPrice: number; turnover24h: number };

async function fetchLinearTickers(): Promise<Map<string, Ticker>> {
  const json = (await fetchJson('https://api.bybit.com/v5/market/tickers?category=linear')) as {
    retCode?: number;
    result?: { list?: Array<{ symbol?: string; lastPrice?: string; turnover24h?: string }> };
  };
  if (json.retCode !== 0) return new Map();
  const map = new Map<string, Ticker>();
  for (const t of json.result?.list ?? []) {
    const sym = String(t.symbol ?? '');
    const lastPrice = Number(t.lastPrice);
    const turnover24h = Number(t.turnover24h);
    if (!sym || !(lastPrice > 0)) continue;
    map.set(sym, { lastPrice, turnover24h: Number.isFinite(turnover24h) ? turnover24h : 0 });
  }
  return map;
}

type DailyBar = { t: number; h: number; l: number; c: number };

/** Velas 1D ascendentes (inclui a vela do dia em formação). */
async function fetchDailyBars(symbol: string): Promise<DailyBar[]> {
  const json = (await fetchJson(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=D&limit=${KLINE_LIMIT}`
  )) as { retCode?: number; result?: { list?: string[][] } };
  if (json.retCode !== 0) return [];
  return (json.result?.list ?? [])
    .map((k) => ({ t: Number(k[0]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]) }))
    .filter((b) => Number.isFinite(b.t) && b.h > 0 && b.l > 0 && b.c > 0)
    .sort((a, b) => a.t - b.t);
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

export async function runScanner9Range6m(options?: { source?: string }): Promise<Scanner9Result> {
  const source = options?.source ?? 'scanner9';
  const [instruments, tickers] = await Promise.all([
    fetchBybitInstrumentsInfoAllPages('linear'),
    fetchLinearTickers(),
  ]);

  const candidates = instruments
    .filter(
      (i) =>
        i.symbol &&
        i.status === 'Trading' &&
        i.quoteCoin === 'USDT' &&
        i.symbolType !== 'stock' &&
        String(i.symbol).endsWith('USDT')
    )
    .map((i) => ({
      symbol: String(i.symbol),
      baseAsset: String(i.baseCoin ?? String(i.symbol).replace(/USDT$/, '')),
      ticker: tickers.get(String(i.symbol)),
    }))
    .filter(
      (c): c is { symbol: string; baseAsset: string; ticker: Ticker } =>
        c.ticker != null && c.ticker.turnover24h >= SCANNER_9_MIN_TURNOVER_24H
    );

  const cutoff = Date.now() - SCANNER_9_LOOKBACK_DAYS * DAY_MS;

  type PartialRow = Omit<Scanner9Row, 'rank'>;
  const partials = await mapPool(candidates, BATCH, async (c): Promise<PartialRow | null> => {
    try {
      const all = await fetchDailyBars(c.symbol);
      if (all.length < SCANNER_9_MIN_HISTORY_DAYS) return null;
      const bars = all.filter((b) => b.t >= cutoff);
      if (bars.length < SCANNER_9_MIN_HISTORY_DAYS) return null;

      let hi = bars[0]!;
      let lo = bars[0]!;
      let sumClose = 0;
      for (const b of bars) {
        if (b.h > hi.h) hi = b;
        if (b.l < lo.l) lo = b;
        sumClose += b.c;
      }
      const price = c.ticker.lastPrice;
      const high6m = Math.max(hi.h, price);
      const low6m = Math.min(lo.l, price);
      const avgClose6m = sumClose / bars.length;
      const span = high6m - low6m;

      return {
        symbol: c.symbol,
        baseAsset: c.baseAsset,
        price,
        high6m,
        high6mAt: new Date(price > hi.h ? Date.now() : hi.t).toISOString().slice(0, 10),
        low6m,
        low6mAt: new Date(price < lo.l ? Date.now() : lo.t).toISOString().slice(0, 10),
        rangePct: (high6m / low6m - 1) * 100,
        pctFromHigh: (price / high6m - 1) * 100,
        pctFromLow: (price / low6m - 1) * 100,
        avgClose6m,
        pctFromAvg: (price / avgClose6m - 1) * 100,
        midRange: (high6m + low6m) / 2,
        rangePositionPct: span > 0 ? ((price - low6m) / span) * 100 : 50,
        turnover24h: c.ticker.turnover24h,
        tradingViewUrl: tradingViewBybitPerpUrl(c.symbol),
      };
    } catch {
      return null;
    }
  });

  const items = partials
    .filter((r): r is PartialRow => r != null)
    .sort((a, b) => b.rangePct - a.rangePct)
    .slice(0, SCANNER_9_TOP_N)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    scannedAt: new Date().toISOString(),
    source,
    lookbackDays: SCANNER_9_LOOKBACK_DAYS,
    minTurnover24h: SCANNER_9_MIN_TURNOVER_24H,
    candidates: candidates.length,
    count: items.length,
    items,
  };
}
