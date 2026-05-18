import type { UniverseScanDefinition } from './universeScanner';

export const UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 = 'UNIVERSE_ABOVE_MA200_1H' as const;

export const UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 =
  'UNIVERSE_NEAR_MA200_PCT10_1H' as const;

export const UNIVERSE_CODE_SCANNER_3_MA80_PCT4 = 'UNIVERSE_NEAR_MA200_PCT4_1H' as const;

export const BUILTIN_UNIVERSE_SCAN: Record<string, UniverseScanDefinition> = {
  UNIVERSE_ABOVE_MA200_1H: {
    ruleType: 'ABOVE_MA',
    maPeriod: 200,
    maxDistancePct: null,
    timeframe: '1h',
    minQuoteVolume: 100000,
    candidateLimit: 400,
  },
  UNIVERSE_NEAR_MA200_PCT10_1H: {
    ruleType: 'WITHIN_PCT_OF_MA',
    maPeriod: 80,
    maType: 'EMA',
    maxDistancePct: 10,
    timeframe: '1h',
    minQuoteVolume: 100000,
    candidateLimit: 400,
  },
  UNIVERSE_NEAR_MA200_PCT4_1H: {
    ruleType: 'WITHIN_PCT_OF_MA',
    maPeriod: 80,
    maxDistancePct: 4,
    timeframe: '1h',
    minQuoteVolume: 100000,
    candidateLimit: 400,
  },
};

export function getBuiltinScanDefinition(code: string): UniverseScanDefinition | null {
  return BUILTIN_UNIVERSE_SCAN[code] ?? null;
}

export const BUILTIN_UNIVERSE_META: Record<
  string,
  { displayName: string; description: string; strategyNames: string }
> = {
  UNIVERSE_ABOVE_MA200_1H: {
    displayName: 'Scanner 1 — Acima da MA200 (1h)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA200 em 1h. Universo: MA Cross 15m / 1h.',
    strategyNames: 'MA_CROSS_5M, MA_CROSS_1H',
  },
  UNIVERSE_NEAR_MA200_PCT10_1H: {
    displayName: 'Scanner 2 — Até ±10% da EMA80 (1h)',
    description:
      'Preço dentro de ±10% da EMA80 em 1h. Universo: RSI queda de 70 + afastamento >12%.',
    strategyNames: 'RSI_OVERBOUGHT_DROP_1H',
  },
  UNIVERSE_NEAR_MA200_PCT4_1H: {
    displayName: 'Scanner 3 — Até ±4% da MA80 (1h)',
    description:
      'Preço dentro de ±4% da MA80 em 1h. Universo: Afastamento médio 1h e Afastamento médio 30m.',
    strategyNames: 'AFASTAMENTO_MEDIO, AFASTAMENTO_MEDIO_30M',
  },
};

/** Rotas UI `/scanners/1` … `/scanners/3` */
export const SCANNER_UI_ROUTES = [
  { scannerId: '1', code: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 },
  { scannerId: '2', code: UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 },
  { scannerId: '3', code: UNIVERSE_CODE_SCANNER_3_MA80_PCT4 },
] as const;

export function getScannerByUiId(scannerId: string) {
  return SCANNER_UI_ROUTES.find((s) => s.scannerId === scannerId) ?? null;
}
