/**
 * Scanner 10 — caça ralis no padrão de ignição do estudo Scanner 9.
 *
 * Receita (20 ralis reais vs 10 bounces):
 *   4H  preço > EMA21 + EMA12 > EMA21 + RSI ≥ 50   (80–85%; estudo mediana 64)
 *   1D  vela verde e/ou vol ≥ 2× MA20              (confirma; não é obrigatório)
 *   Low de 90d há 0–21 dias (mediana no estudo: 3)
 *   BTC do dia ≥ −1%
 *   Rejeita bounce: máxima 90d antes do mínimo E Daily ainda < EMA21 com RSI < 50
 */

import { fetchBybitInstrumentsInfoAllPages } from '@/lib/marketData';

export const SCANNER_10_CACHE_KEY = 'SCANNER_10_RALLY_IGNITION_LAST' as const;
export const SCANNER_10_UNIVERSE_CODE = 'UNIVERSE_RALLY_IGNITION_4H' as const;

export const SCANNER_10_TOP_N = 40;
/** Janela do swing low (caça o arranque, não o fundo de 6 meses). */
export const SCANNER_10_SWING_DAYS = 30;
/** Janela para classificar rise vs bounce. */
export const SCANNER_10_RANGE_DAYS = 90;
export const SCANNER_10_LOOKBACK_DAYS = SCANNER_10_SWING_DAYS;
export const SCANNER_10_MAX_DAYS_FROM_LOW = 15;
export const SCANNER_10_MAX_PCT_FROM_LOW = 55;
/** Queda mínima high→low na janela de 30d (evita laterais sem washout). */
export const SCANNER_10_MIN_WASH_PCT = 12;
export const SCANNER_10_MIN_HISTORY_DAYS = 80;
export const SCANNER_10_MIN_H4_BARS = 60;
export const SCANNER_10_MIN_TURNOVER_24H = 1_000_000;
/** 50 = a formar; o estudo tinha mediana 64 e 70% ≥60. Score privilegia ≥55. */
export const SCANNER_10_H4_RSI_MIN = 50;
export const SCANNER_10_BTC_MIN_PCT = -1;

/** TradFi inverso / 3× — sobem quando o cripto cai; não são rali. */
const EXCLUDE_BASES = new Set([
  'UVXY',
  'SVXY',
  'VIXY',
  'UVIX',
  'SVIX',
  'SOXS',
  'SOXL',
  'SQQQ',
  'TQQQ',
  'SPXU',
  'SPXS',
  'SDOW',
  'UDOW',
  'TZA',
  'TNA',
  'LABD',
  'LABU',
  'YANG',
  'YINN',
  'FAZ',
  'FAS',
  'BOIL',
  'KOLD',
]);

export type Scanner10Stage = 'ignition' | 'early';

export type Scanner10Row = {
  rank: number;
  symbol: string;
  baseAsset: string;
  price: number;
  score: number;
  stage: Scanner10Stage;
  kind: 'rise' | 'bounce';
  daysFromLow: number;
  lowAt: string;
  highAt: string;
  pctFromLow: number;
  washPct: number;
  /** true se o mínimo de 90d também é recente (qualidade do estudo Scanner 9). */
  fresh90dLow: boolean;
  d1Green: boolean;
  d1Rsi: number | null;
  d1VolX: number | null;
  d1AboveEma12: boolean | null;
  d1AboveEma21: boolean | null;
  d1Ema12gt21: boolean | null;
  h4Rsi: number | null;
  h4AboveEma21: boolean | null;
  h4Ema12gt21: boolean | null;
  h4AboveEma50: boolean | null;
  btcDayPct: number | null;
  change24hPct: number | null;
  turnover24h: number;
  tradingViewUrl: string;
};

export type Scanner10Result = {
  scannedAt: string;
  source: string;
  lookbackDays: number;
  minTurnover24h: number;
  btcDayPct: number | null;
  btcOk: boolean;
  candidates: number;
  prefiltered: number;
  count: number;
  items: Scanner10Row[];
};

const BATCH = 6;
const D1_LIMIT = 200;
const H4_LIMIT = 200;
const DAY_MS = 86_400_000;

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

type Ticker = { lastPrice: number; turnover24h: number; change24hPct: number | null };

function tradingViewBybitPerpUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BYBIT:${symbol.toUpperCase()}.P`)}`;
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function round(n: number, d = 1): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = 0; i < period; i++) s += values[i]!;
  let prev = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
  }
  return prev;
}

function rsiLast(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d;
    else l -= d;
  }
  let ag = g / period;
  let al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function smaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i]!;
  return s / period;
}

async function fetchLinearTickers(): Promise<Map<string, Ticker>> {
  const json = (await fetchJson('https://api.bybit.com/v5/market/tickers?category=linear')) as {
    retCode?: number;
    result?: {
      list?: Array<{
        symbol?: string;
        lastPrice?: string;
        turnover24h?: string;
        price24hPcnt?: string;
      }>;
    };
  };
  if (json.retCode !== 0) return new Map();
  const map = new Map<string, Ticker>();
  for (const t of json.result?.list ?? []) {
    const sym = String(t.symbol ?? '');
    const lastPrice = Number(t.lastPrice);
    const turnover24h = Number(t.turnover24h);
    const rawPcnt = Number(t.price24hPcnt);
    if (!sym || !(lastPrice > 0)) continue;
    map.set(sym, {
      lastPrice,
      turnover24h: Number.isFinite(turnover24h) ? turnover24h : 0,
      change24hPct: Number.isFinite(rawPcnt) ? rawPcnt * 100 : null,
    });
  }
  return map;
}

async function fetchKlines(symbol: string, interval: 'D' | '240', limit: number): Promise<Bar[]> {
  const json = (await fetchJson(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
  )) as { retCode?: number; result?: { list?: string[][] } };
  if (json.retCode !== 0) return [];
  return (json.result?.list ?? [])
    .map((k) => ({
      t: Number(k[0]),
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[6] || k[5]),
    }))
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
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function scoreRow(p: Omit<Scanner10Row, 'rank'>): number {
  let s = 0;
  if (p.h4Rsi != null && p.h4Rsi >= 60) s += 3;
  else if (p.h4Rsi != null && p.h4Rsi >= 55) s += 2;
  else s += 1;
  if (p.h4AboveEma50) s += 2;
  if (p.d1Green) s += 2;
  if (p.d1AboveEma12) s += 2;
  if (p.d1AboveEma21) s += 2;
  if (p.d1VolX != null && p.d1VolX >= 2) s += 3;
  if (p.d1Rsi != null) {
    if (p.d1Rsi >= 45 && p.d1Rsi <= 70) s += 2;
    else if (p.d1Rsi > 70 && p.d1Rsi <= 80) s += 1;
  }
  if (p.daysFromLow <= 9) s += 3;
  else if (p.daysFromLow <= 15) s += 2;
  else s += 1;
  if (p.btcDayPct != null && p.btcDayPct >= 0) s += 1;
  if (p.kind === 'rise') s += 2;
  if (p.fresh90dLow) s += 3;
  if (p.pctFromLow <= 15) s += 3;
  else if (p.pctFromLow <= 25) s += 2;
  else if (p.pctFromLow <= 40) s += 1;
  if (p.washPct >= 25) s += 1;
  return s;
}

export async function runScanner10RallyIgnition(options?: { source?: string }): Promise<Scanner10Result> {
  const source = options?.source ?? 'scanner10';
  const [instruments, tickers, btcDaily] = await Promise.all([
    fetchBybitInstrumentsInfoAllPages('linear'),
    fetchLinearTickers(),
    fetchKlines('BTCUSDT', 'D', 5),
  ]);

  const btcLast = btcDaily[btcDaily.length - 1];
  const btcPrev = btcDaily[btcDaily.length - 2];
  const btcDayPct =
    btcLast && btcPrev && btcPrev.c > 0 ? round(((btcLast.c / btcPrev.c - 1) * 100), 2) : null;
  const btcOk = btcDayPct == null || btcDayPct >= SCANNER_10_BTC_MIN_PCT;

  const candidates = instruments
    .filter(
      (i) =>
        i.symbol &&
        i.status === 'Trading' &&
        i.quoteCoin === 'USDT' &&
        i.symbolType !== 'stock' &&
        i.symbolType !== 'xstocks' &&
        String(i.symbol).endsWith('USDT') &&
        !EXCLUDE_BASES.has(String(i.baseCoin ?? String(i.symbol).replace(/USDT$/, '')).toUpperCase())
    )
    .map((i) => ({
      symbol: String(i.symbol),
      baseAsset: String(i.baseCoin ?? String(i.symbol).replace(/USDT$/, '')),
      ticker: tickers.get(String(i.symbol)),
    }))
    .filter(
      (c): c is { symbol: string; baseAsset: string; ticker: Ticker } =>
        c.ticker != null && c.ticker.turnover24h >= SCANNER_10_MIN_TURNOVER_24H
    );

  const cutoffSwing = Date.now() - SCANNER_10_SWING_DAYS * DAY_MS;
  const cutoffRange = Date.now() - SCANNER_10_RANGE_DAYS * DAY_MS;

  type DailyPass = {
    symbol: string;
    baseAsset: string;
    ticker: Ticker;
    kind: 'rise' | 'bounce';
    daysFromLow: number;
    lowAt: string;
    highAt: string;
    pctFromLow: number;
    washPct: number;
    fresh90dLow: boolean;
    d1Green: boolean;
    d1Rsi: number | null;
    d1VolX: number | null;
    d1AboveEma12: boolean | null;
    d1AboveEma21: boolean | null;
    d1Ema12gt21: boolean | null;
  };

  const dailyPasses = await mapPool(candidates, BATCH, async (c): Promise<DailyPass | null> => {
    try {
      const all = await fetchKlines(c.symbol, 'D', D1_LIMIT);
      if (all.length < SCANNER_10_MIN_HISTORY_DAYS) return null;
      const swing = all.filter((b) => b.t >= cutoffSwing);
      const range = all.filter((b) => b.t >= cutoffRange);
      if (swing.length < 20 || range.length < 40) return null;

      let swingHi = swing[0]!;
      let swingLo = swing[0]!;
      for (const b of swing) {
        if (b.h > swingHi.h) swingHi = b;
        if (b.l < swingLo.l) swingLo = b;
      }
      let rangeHi = range[0]!;
      let rangeLo = range[0]!;
      for (const b of range) {
        if (b.h > rangeHi.h) rangeHi = b;
        if (b.l < rangeLo.l) rangeLo = b;
      }

      const last = swing[swing.length - 1]!;
      const daysFromLow = Math.max(0, Math.round((last.t - swingLo.t) / DAY_MS));
      if (daysFromLow > SCANNER_10_MAX_DAYS_FROM_LOW) return null;

      const price = c.ticker.lastPrice;
      const pctFromLow = swingLo.l > 0 ? (price / swingLo.l - 1) * 100 : 0;
      if (pctFromLow > SCANNER_10_MAX_PCT_FROM_LOW) return null;

      const washPct = swingHi.h > 0 ? ((swingHi.h - swingLo.l) / swingHi.h) * 100 : 0;
      if (washPct < SCANNER_10_MIN_WASH_PCT) return null;

      const closes = all.map((b) => b.c);
      const vols = all.map((b) => b.v);
      const ema12 = emaLast(closes, 12);
      const ema21 = emaLast(closes, 21);
      const rsi = rsiLast(closes, 14);
      const volMa = smaLast(vols, 20);
      const d1AboveEma21 = ema21 != null ? last.c > ema21 : null;
      const kind: 'rise' | 'bounce' = rangeHi.t > rangeLo.t ? 'rise' : 'bounce';
      const fresh90dLow = Math.round((last.t - rangeLo.t) / DAY_MS) <= 21;

      if (kind === 'bounce' && d1AboveEma21 === false && rsi != null && rsi < 50) return null;

      return {
        symbol: c.symbol,
        baseAsset: c.baseAsset,
        ticker: c.ticker,
        kind,
        daysFromLow,
        lowAt: isoDay(swingLo.t),
        highAt: isoDay(rangeHi.t),
        pctFromLow: round(pctFromLow, 1),
        washPct: round(washPct, 1),
        fresh90dLow,
        d1Green: last.c > last.o,
        d1Rsi: rsi != null ? round(rsi, 1) : null,
        d1VolX: volMa != null && volMa > 0 ? round(last.v / volMa, 2) : null,
        d1AboveEma12: ema12 != null ? last.c > ema12 : null,
        d1AboveEma21,
        d1Ema12gt21: ema12 != null && ema21 != null ? ema12 > ema21 : null,
      };
    } catch {
      return null;
    }
  });

  const prefiltered = dailyPasses.filter((r): r is DailyPass => r != null);

  const confirmed = await mapPool(prefiltered, BATCH, async (p): Promise<Omit<Scanner10Row, 'rank'> | null> => {
    try {
      const h4 = await fetchKlines(p.symbol, '240', H4_LIMIT);
      if (h4.length < SCANNER_10_MIN_H4_BARS) return null;
      const last = h4[h4.length - 1]!;
      const closes = h4.map((b) => b.c);
      const ema12 = emaLast(closes, 12);
      const ema21 = emaLast(closes, 21);
      const ema50 = emaLast(closes, 50);
      const rsi = rsiLast(closes, 14);
      if (ema12 == null || ema21 == null || rsi == null) return null;
      if (!(last.c > ema21) || !(ema12 > ema21) || rsi < SCANNER_10_H4_RSI_MIN) return null;
      if (!btcOk) return null;

      const row: Omit<Scanner10Row, 'rank'> = {
        symbol: p.symbol,
        baseAsset: p.baseAsset,
        price: p.ticker.lastPrice,
        score: 0,
        stage: p.daysFromLow <= 9 ? 'ignition' : 'early',
        kind: p.kind,
        daysFromLow: p.daysFromLow,
        lowAt: p.lowAt,
        highAt: p.highAt,
        pctFromLow: p.pctFromLow,
        washPct: p.washPct,
        fresh90dLow: p.fresh90dLow,
        d1Green: p.d1Green,
        d1Rsi: p.d1Rsi,
        d1VolX: p.d1VolX,
        d1AboveEma12: p.d1AboveEma12,
        d1AboveEma21: p.d1AboveEma21,
        d1Ema12gt21: p.d1Ema12gt21,
        h4Rsi: round(rsi, 1),
        h4AboveEma21: true,
        h4Ema12gt21: true,
        h4AboveEma50: ema50 != null ? last.c > ema50 : null,
        btcDayPct,
        change24hPct: p.ticker.change24hPct != null ? round(p.ticker.change24hPct, 2) : null,
        turnover24h: p.ticker.turnover24h,
        tradingViewUrl: tradingViewBybitPerpUrl(p.symbol),
      };
      row.score = scoreRow(row);
      return row;
    } catch {
      return null;
    }
  });

  const items = confirmed
    .filter((r): r is Omit<Scanner10Row, 'rank'> => r != null)
    .sort((a, b) => b.score - a.score || (b.h4Rsi ?? 0) - (a.h4Rsi ?? 0))
    .slice(0, SCANNER_10_TOP_N)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    scannedAt: new Date().toISOString(),
    source,
    lookbackDays: SCANNER_10_LOOKBACK_DAYS,
    minTurnover24h: SCANNER_10_MIN_TURNOVER_24H,
    btcDayPct,
    btcOk,
    candidates: candidates.length,
    prefiltered: prefiltered.length,
    count: items.length,
    items,
  };
}
