/**
 * Universo operacional rsi_qqq: top 30 Bybit stocks (YTD study) + QQQUSDT.
 */
export const RSI_QQQ_SYMBOLS_DEFAULT = [
  'SKHYNIXUSDT',
  'WDCUSDT',
  'CRWVUSDT',
  'SKHYUSDT',
  'NOKIAUSDT',
  'STXXUSDT',
  'PENGSTOCKUSDT',
  'MUUSDT',
  'GLWUSDT',
  'AXTIUSDT',
  'DKNGUSDT',
  'ARMUSDT',
  'POETUSDT',
  'VRTUSDT',
  'RIVNUSDT',
  'SNDKUSDT',
  'NOWUSDT',
  'RDDTUSDT',
  'ORCLUSDT',
  'HOODUSDT',
  'GOOGLUSDT',
  'CBRSUSDT',
  'ZMUSDT',
  'MRVLUSDT',
  'RKLBUSDT',
  'SHOPUSDT',
  'AAOIUSDT',
  'CIENUSDT',
  'SOFIUSDT',
  'CIFRUSDT',
  'QQQUSDT',
] as const;

export type RsiQqqSymbol = (typeof RSI_QQQ_SYMBOLS_DEFAULT)[number];

export function resolveRsiQqqSymbols(params: {
  symbols?: unknown;
  symbol?: unknown;
}): string[] {
  if (Array.isArray(params.symbols) && params.symbols.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of params.symbols) {
      const sym = String(s || '')
        .trim()
        .toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push(sym);
    }
    if (out.length) return out;
  }
  const single = String(params.symbol || '')
    .trim()
    .toUpperCase();
  if (single) return [single];
  return [...RSI_QQQ_SYMBOLS_DEFAULT];
}
