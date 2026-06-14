import type { UniverseScanDefinition } from './universeScanner';



export const UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 = 'UNIVERSE_ABOVE_MA200_1H' as const;



/** Legado — scanners 2/4 removidos do bot_scanner. */

export const UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 =

  'UNIVERSE_NEAR_MA200_PCT10_1H' as const;



export const UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D = 'UNIVERSE_ABOVE_MA200_1D' as const;



/** Legado — AFASTAMENTO_MEDIO 1h (descontinuado). */

export const UNIVERSE_CODE_SCANNER_3_MA80_PCT4 = 'UNIVERSE_NEAR_MA200_PCT4_4H' as const;



export const SCANNER_2_MIN_DISTANCE_PCT = -5;

export const SCANNER_2_MAX_DISTANCE_PCT = 15;

export const SCANNER_2_EMA80_BAND_LABEL = '-5% a +15% da EMA80 (1h)';



/** Só Scanner 1 — MA Cross 15m + Pivot Boss Bear 15m. */

export const BUILTIN_UNIVERSE_SCAN: Record<string, UniverseScanDefinition> = {

  UNIVERSE_ABOVE_MA200_1H: {

    ruleType: 'ABOVE_MA',

    maPeriod: 200,

    minDistancePct: null,

    maxDistancePct: null,

    timeframe: '1h',

    minQuoteVolume: 500000,

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

    displayName: 'Scanner 1 — Acima SMA200 (1h)',

    description:

      'Perpétuos USDT (top volume) com fecho acima da SMA200 em 1h. MA Cross: top 20; Pivot Boss: top 10; Top 6: rotação ranks 1,2,5–8.',

    strategyNames: 'MA Cross 12×30 (15m), Pivot Boss Bear 15m, Scanner 1 Top 6',

  },

};



/** Sem rotações Top neste projeto (estão no bot_cripto). */

export const SCANNER_ROTATION_NOTES: Record<string, string> = {};



export const SCANNER_UI_ROUTES = [

  { scannerId: '1', code: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 },

] as const;



export function getScannerByUiId(scannerId: string) {

  return SCANNER_UI_ROUTES.find((s) => s.scannerId === scannerId) ?? null;

}


