import type { UniverseScanDefinition } from './universeScanner';

export const UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 = 'UNIVERSE_ABOVE_MA200_1H' as const;

export const UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H = 'UNIVERSE_TOP30_PRICE_CHANGE_24H' as const;

/** @deprecated Use UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H */
export const UNIVERSE_CODE_SCANNER_2_TOP30_VOLUME_24H = UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H;

/** Legado — afastamento / scanners antigos. */
export const UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 =
  'UNIVERSE_NEAR_MA200_PCT10_1H' as const;

export const UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D = 'UNIVERSE_ABOVE_MA200_1D' as const;

/** @deprecated Scanner 3 legado (MA80 ±4% 4h) — substituído pelo Scanner 3 RSI 15m. */
export const UNIVERSE_CODE_SCANNER_3_MA80_PCT4 = 'UNIVERSE_NEAR_MA200_PCT4_4H' as const;

export const UNIVERSE_CODE_SCANNER_3_RSI75_15M = 'UNIVERSE_RSI_ABOVE_75_15M' as const;

export const UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H = 'UNIVERSE_ABOVE_MA80_4H' as const;

export const SCANNER_3_RSI_PERIOD = 14;
export const SCANNER_3_RSI_THRESHOLD = 75;

export const SCANNER_2_MIN_DISTANCE_PCT = -5;
export const SCANNER_2_MAX_DISTANCE_PCT = 15;
export const SCANNER_2_EMA80_BAND_LABEL = '-5% a +15% da EMA80 (1h)';

/** Scanners 1 e 2 — actualizados em run-universe-scans (4 h). */
export const BUILTIN_UNIVERSE_SCAN_4H: Record<string, UniverseScanDefinition> = {
  UNIVERSE_ABOVE_MA200_1H: {
    ruleType: 'ABOVE_MA',
    maPeriod: 200,
    minDistancePct: null,
    maxDistancePct: null,
    timeframe: '1h',
    minQuoteVolume: 500000,
    candidateLimit: 400,
  },
  UNIVERSE_TOP30_PRICE_CHANGE_24H: {
    ruleType: 'TOP_PRICE_CHANGE_24H',
    maPeriod: 0,
    minDistancePct: null,
    maxDistancePct: null,
    timeframe: '24h',
    minQuoteVolume: 500000,
    candidateLimit: 30,
    resultLimit: 30,
  },
  UNIVERSE_ABOVE_MA80_4H: {
    ruleType: 'ABOVE_MA',
    maPeriod: 80,
    minDistancePct: null,
    maxDistancePct: null,
    timeframe: '4h',
    minQuoteVolume: 500000,
    candidateLimit: 400,
  },
};

/** Scanner 3 — RSI > 75 (15m); scan descontinuado (dados históricos na UI). */
export const BUILTIN_UNIVERSE_SCAN_15M: Record<string, UniverseScanDefinition> = {
  UNIVERSE_RSI_ABOVE_75_15M: {
    ruleType: 'RSI_ABOVE',
    maPeriod: 0,
    minDistancePct: null,
    maxDistancePct: null,
    timeframe: '15m',
    minQuoteVolume: 500000,
    candidateLimit: 400,
    rsiPeriod: SCANNER_3_RSI_PERIOD,
    rsiThreshold: SCANNER_3_RSI_THRESHOLD,
  },
};

/** Todos os scanners builtin (UI, ensure, definições). */
export const BUILTIN_UNIVERSE_SCAN: Record<string, UniverseScanDefinition> = {
  ...BUILTIN_UNIVERSE_SCAN_4H,
  ...BUILTIN_UNIVERSE_SCAN_15M,
};

export function getBuiltinScanDefinition(code: string): UniverseScanDefinition | null {
  return BUILTIN_UNIVERSE_SCAN[code] ?? null;
}

/** Scanners com ranking fixo (ordem de inserção), não |pctFromMa|. */
export function isTickerRankUniverseScan(code: string): boolean {
  const rt = BUILTIN_UNIVERSE_SCAN[code]?.ruleType;
  return rt === 'TOP_PRICE_CHANGE_24H' || rt === 'TOP_VOLUME_24H' || rt === 'RSI_ABOVE';
}

/** Scanners ordenados por RSI (coluna RSI na UI). */
export function isRsiRankUniverseScan(code: string): boolean {
  return BUILTIN_UNIVERSE_SCAN[code]?.ruleType === 'RSI_ABOVE';
}

/** @deprecated Use isTickerRankUniverseScan */
export const isVolumeRankUniverseScan = isTickerRankUniverseScan;

export const BUILTIN_UNIVERSE_META: Record<
  string,
  { displayName: string; description: string; strategyNames: string }
> = {
  UNIVERSE_ABOVE_MA200_1H: {
    displayName: 'Scanner 1 — Acima SMA200 (1h)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA200 em 1h. MA Cross: top 20; Pivot Boss: top 30; Rompimento: ranks 11–40; Top 6: rotação.',
    strategyNames: 'MA Cross 12×30 (15m), Pivot Boss Bear 15m, Rompimento 15m, Quebra EMA80 15m',
  },
  UNIVERSE_TOP30_PRICE_CHANGE_24H: {
    displayName: 'Scanner 2 — Top 30 subidas 24h',
    description:
      'Top 30 perpétuos USDT com maior subida de preço nas últimas 24h (apenas variação positiva). Mín. 500k USDT volume 24h.',
    strategyNames: 'Scanner 2 Top 8 (rotação 4h), Scanner 2 Short Leader 24h',
  },
  UNIVERSE_RSI_ABOVE_75_15M: {
    displayName: 'Scanner 3 — RSI > 75 (15m)',
    description:
      'Perpétuos USDT (top volume) com RSI(14) acima de 75 em velas de 15m, ordenados por RSI (maior primeiro). Mín. 500k USDT volume 24h. Actualização a cada 15 min (cron run-15m).',
    strategyNames: '— (sem estratégia activa)',
  },
  UNIVERSE_ABOVE_MA80_4H: {
    displayName: 'Scanner 6 — Acima SMA80 (4h)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA80 em velas 4h. Rotação long no bot_cripto.',
    strategyNames: 'SCANNER_MA80_4H_TOP6 (bot_cripto)',
  },
};

export const SCANNER_ROTATION_NOTES: Record<string, string> = {
  '2': 'Scanner 2 Short Leader 24h: SHORT ranks #1–#2 — pump ≥25%, hold 24h, SL +40%.',
};

export const SCANNER_UI_ROUTES = [
  { scannerId: '1', code: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 },
  { scannerId: '2', code: UNIVERSE_CODE_SCANNER_2_TOP30_PRICE_24H },
  { scannerId: '3', code: UNIVERSE_CODE_SCANNER_3_RSI75_15M },
  { scannerId: '6', code: UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H },
] as const;

export function getScannerByUiId(scannerId: string) {
  return SCANNER_UI_ROUTES.find((s) => s.scannerId === scannerId) ?? null;
}
