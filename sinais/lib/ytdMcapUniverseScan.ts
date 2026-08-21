/**
 * Scanner YTD + market cap: top N por valorização desde 1 Jan,
 * filtrado por mcap CoinGecko > limiar (defeito $60M).
 */

import { fetchCandles, fetchTopSymbolsByVolume } from './marketData';

export type YtdMcapScanRow = {
  symbol: string;
  close: number;
  /** Market cap USD (gravado em `ma` no universe scan). */
  ma: number;
  /** % YTD (gravado em `pctFromMa`). */
  pctFromMa: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseSymbol(symbol: string): string {
  return symbol.replace(/USDT$/i, '');
}

function cgLookupKey(base: string): string {
  if (base.startsWith('1000000')) return base.slice(7);
  if (base.startsWith('1000')) return base.slice(4);
  return base;
}

/** Mapa SYMBOL → market cap USD (CoinGecko top markets). */
export async function fetchCoinGeckoMarketCapBySymbol(): Promise<Map<string, number>> {
  const bySym = new Map<string, number>();
  for (let page = 1; page <= 3; page++) {
    const url =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
      `&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`CoinGecko markets HTTP ${res.status}`);
    }
    const arr = (await res.json()) as Array<{
      symbol?: string;
      market_cap?: number | null;
    }>;
    for (const c of arr) {
      const sym = String(c.symbol || '').toUpperCase();
      const mcap = Number(c.market_cap ?? 0);
      if (!sym || !(mcap > 0)) continue;
      const prev = bySym.get(sym) ?? 0;
      if (mcap > prev) bySym.set(sym, mcap);
    }
    if (page < 3) await delay(1100);
  }
  return bySym;
}

function jan1UtcMs(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
}

/**
 * Calcula YTD vs abertura da 1.ª vela diária em/após 1 Jan.
 * Exige que o listing exista desde ~início de janeiro (≤3 dias após Jan 1).
 */
export async function scanTopYtdMcapUniverse(opts: {
  minMarketCapUsd?: number;
  minQuoteVolume?: number;
  candidateLimit?: number;
  resultLimit?: number;
}): Promise<YtdMcapScanRow[]> {
  const minMcap = Math.max(0, Number(opts.minMarketCapUsd ?? 60_000_000));
  const minVol = Math.max(0, Number(opts.minQuoteVolume ?? 1_000_000));
  const candidateLimit = Math.min(Math.max(opts.candidateLimit ?? 220, 50), 400);
  const resultLimit = Math.max(1, Math.floor(opts.resultLimit ?? 50));
  const jan1 = jan1UtcMs();

  const mcapBySym = await fetchCoinGeckoMarketCapBySymbol();
  const symbols = await fetchTopSymbolsByVolume(candidateLimit, minVol);

  const eligible = symbols.filter((symbol) => {
    const base = baseSymbol(symbol);
    const mcap =
      mcapBySym.get(cgLookupKey(base)) ?? mcapBySym.get(base) ?? 0;
    return mcap >= minMcap;
  });

  console.log(
    `[YTD-Mcap] candidatos vol=${symbols.length}, com mcap≥$${minMcap / 1e6}M: ${eligible.length}`
  );

  const rows: YtdMcapScanRow[] = [];
  const BATCH = 4;
  for (let i = 0; i < eligible.length; i += BATCH) {
    const chunk = eligible.slice(i, i + BATCH);
    const part = await Promise.all(
      chunk.map(async (symbol): Promise<YtdMcapScanRow | null> => {
        try {
          const candles = await fetchCandles(symbol, '1d', 250);
          if (candles.length < 30) return null;
          const closed = candles.slice(0, -1);
          let basePx: number | null = null;
          let firstTs: number | null = null;
          for (const c of closed) {
            if (c.timestamp >= jan1) {
              basePx = c.open;
              firstTs = c.timestamp;
              break;
            }
          }
          if (basePx == null || !(basePx > 0) || firstTs == null) return null;
          if (firstTs - jan1 > 3 * 86_400_000) return null;
          const last = closed[closed.length - 1]!;
          const close = last.close;
          if (!(close > 0)) return null;
          const pctYtd = ((close - basePx) / basePx) * 100;
          const base = baseSymbol(symbol);
          const mcap =
            mcapBySym.get(cgLookupKey(base)) ?? mcapBySym.get(base) ?? 0;
          return { symbol, close, ma: mcap, pctFromMa: pctYtd };
        } catch {
          return null;
        }
      })
    );
    for (const r of part) {
      if (r) rows.push(r);
    }
    await delay(80);
  }

  rows.sort((a, b) => b.pctFromMa - a.pctFromMa);
  return rows.slice(0, resultLimit);
}

/** Seed inicial (snapshot 21/08/2026) — usado se ainda não houver scan na BD. */
export const YTD_MCAP60_SEED_ROWS: YtdMcapScanRow[] = [
  { symbol: 'AKEUSDT', close: 0.008372, ma: 189_700_000, pctFromMa: 1850.61 },
  { symbol: 'VVVUSDT', close: 15.547, ma: 737_400_000, pctFromMa: 848.33 },
  { symbol: 'VELVETUSDT', close: 0.7532, ma: 320_400_000, pctFromMa: 426.35 },
  { symbol: 'BRUSDT', close: 0.23589, ma: 68_700_000, pctFromMa: 289.58 },
  { symbol: 'USUSDT', close: 0.02317, ma: 65_100_000, pctFromMa: 251.65 },
  { symbol: 'HYPEUSDT', close: 76.61, ma: 17_019_400_000, pctFromMa: 201.06 },
  { symbol: 'ALLOUSDT', close: 0.3023, ma: 74_100_000, pctFromMa: 167.74 },
  { symbol: 'GPSUSDT', close: 0.013311, ma: 77_900_000, pctFromMa: 162.54 },
  { symbol: 'STABLEUSDT', close: 0.03248, ma: 835_400_000, pctFromMa: 132.86 },
  { symbol: 'BOMEUSDT', close: 0.0012571, ma: 87_200_000, pctFromMa: 132.15 },
  { symbol: 'MORPHOUSDT', close: 2.477, ma: 1_614_600_000, pctFromMa: 127.02 },
  { symbol: 'PIEVERSEUSDT', close: 1.0875, ma: 300_800_000, pctFromMa: 107.9 },
  { symbol: 'CYSUSDT', close: 0.5368, ma: 86_800_000, pctFromMa: 84.34 },
  { symbol: 'APRUSDT', close: 0.222, ma: 62_100_000, pctFromMa: 74.98 },
  { symbol: 'JTOUSDT', close: 0.6205, ma: 317_800_000, pctFromMa: 58.7 },
  { symbol: 'ZECUSDT', close: 679.27, ma: 11_386_900_000, pctFromMa: 32.75 },
  { symbol: 'AXSUSDT', close: 1.025, ma: 178_400_000, pctFromMa: 27.44 },
  { symbol: 'NEARUSDT', close: 1.898, ma: 2_471_900_000, pctFromMa: 25.46 },
  { symbol: 'MONUSDT', close: 0.02798, ma: 330_500_000, pctFromMa: 23.14 },
  { symbol: 'TRXUSDT', close: 0.3404, ma: 32_299_500_000, pctFromMa: 19.69 },
  { symbol: 'AEROUSDT', close: 0.4807, ma: 472_200_000, pctFromMa: 19.58 },
  { symbol: 'INJUSDT', close: 5.005, ma: 500_600_000, pctFromMa: 19.54 },
  { symbol: 'LITUSDT', close: 2.895, ma: 718_000_000, pctFromMa: 16.63 },
  { symbol: 'GRASSUSDT', close: 0.331, ma: 214_800_000, pctFromMa: 16.14 },
  { symbol: 'RENDERUSDT', close: 1.49, ma: 772_500_000, pctFromMa: 15.96 },
  { symbol: 'JUPUSDT', close: 0.2106, ma: 697_300_000, pctFromMa: 11.96 },
  { symbol: 'ONDOUSDT', close: 0.4014, ma: 1_952_900_000, pctFromMa: 11.9 },
  { symbol: 'VIRTUALUSDT', close: 0.7137, ma: 468_100_000, pctFromMa: 10.7 },
  { symbol: 'ORDIUSDT', close: 4.464, ma: 93_800_000, pctFromMa: 7.31 },
  { symbol: 'PAXGUSDT', close: 4602.3, ma: 2_004_600_000, pctFromMa: 6.16 },
  { symbol: 'XAUTUSDT', close: 4590.5, ma: 2_812_300_000, pctFromMa: 6.04 },
  { symbol: 'TAOUSDT', close: 231.7, ma: 2_213_700_000, pctFromMa: 5.76 },
  { symbol: 'ASTERUSDT', close: 0.7218, ma: 1_942_100_000, pctFromMa: 4.29 },
  { symbol: 'XLMUSDT', close: 0.1925, ma: 6_658_000_000, pctFromMa: -4.11 },
  { symbol: 'USELESSUSDT', close: 0.06096, ma: 60_500_000, pctFromMa: -4.15 },
  { symbol: 'PENGUUSDT', close: 0.008259, ma: 517_600_000, pctFromMa: -4.72 },
  { symbol: 'LINKUSDT', close: 11.545, ma: 8_654_400_000, pctFromMa: -5.38 },
  { symbol: 'XMRUSDT', close: 410.8, ma: 7_709_500_000, pctFromMa: -5.41 },
  { symbol: 'SPXUSDT', close: 0.4479, ma: 411_800_000, pctFromMa: -5.8 },
  { symbol: '1000PEPEUSDT', close: 0.003783, ma: 1_589_700_000, pctFromMa: -6.18 },
  { symbol: 'PLUMEUSDT', close: 0.01482, ma: 95_000_000, pctFromMa: -10.51 },
  { symbol: 'ICPUSDT', close: 2.508, ma: 1_398_500_000, pctFromMa: -11.5 },
  { symbol: 'POLUSDT', close: 0.08879, ma: 947_500_000, pctFromMa: -11.56 },
  { symbol: 'BTCUSDT', close: 77280.9, ma: 1_551_444_200_000, pctFromMa: -11.77 },
  { symbol: 'CRVUSDT', close: 0.3165, ma: 489_300_000, pctFromMa: -11.81 },
  { symbol: 'TIAUSDT', close: 0.3939, ma: 378_700_000, pctFromMa: -13.52 },
  { symbol: 'PENDLEUSDT', close: 1.623, ma: 278_600_000, pctFromMa: -13.76 },
  { symbol: 'PYTHUSDT', close: 0.04804, ma: 378_500_000, pctFromMa: -13.86 },
  { symbol: 'ETHFIUSDT', close: 0.5915, ma: 603_200_000, pctFromMa: -13.95 },
  { symbol: 'METUSDT', close: 0.2159, ma: 117_300_000, pctFromMa: -14.09 },
];
