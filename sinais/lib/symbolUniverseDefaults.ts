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
