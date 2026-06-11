import type { UniverseScanDefinition } from './universeScanner';

export const UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 = 'UNIVERSE_ABOVE_MA200_1H' as const;

export const UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 =
  'UNIVERSE_NEAR_MA200_PCT10_1H' as const;

export const UNIVERSE_CODE_SCANNER_3_MA80_PCT4 = 'UNIVERSE_NEAR_MA200_PCT4_4H' as const;

export const UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D = 'UNIVERSE_ABOVE_MA200_1D' as const;

export const UNIVERSE_CODE_SCANNER_5_ABOVE_MA80_1D = 'UNIVERSE_ABOVE_MA80_1D' as const;

export const UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H = 'UNIVERSE_ABOVE_MA80_4H' as const;

export const SCANNER_1_MIN_DISTANCE_PCT = 2;
/** Sem tecto: qualquer fecho acima da SMA200 (1h). */
export const SCANNER_1_MAX_DISTANCE_PCT = null as number | null;

/** Scanner 2: banda assimétrica vs EMA80 (1h). */
export const SCANNER_2_MIN_DISTANCE_PCT = -5;
export const SCANNER_2_MAX_DISTANCE_PCT = 15;
export const SCANNER_2_EMA80_BAND_LABEL = '-5% a +15% da EMA80 (1h)';

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
  UNIVERSE_NEAR_MA200_PCT10_1H: {
    ruleType: 'WITHIN_PCT_OF_MA',
    maPeriod: 80,
    maType: 'EMA',
    minDistancePct: SCANNER_2_MIN_DISTANCE_PCT,
    maxDistancePct: SCANNER_2_MAX_DISTANCE_PCT,
    timeframe: '1h',
    minQuoteVolume: 500000,
    candidateLimit: 400,
  },
  UNIVERSE_NEAR_MA200_PCT4_4H: {
    ruleType: 'WITHIN_PCT_OF_MA',
    maPeriod: 80,
    maxDistancePct: 4,
    timeframe: '4h',
    minQuoteVolume: 500000,
    candidateLimit: 400,
  },
  UNIVERSE_ABOVE_MA200_1D: {
    ruleType: 'ABOVE_MA',
    maPeriod: 200,
    minDistancePct: null,
    maxDistancePct: null,
    timeframe: '1d',
    minQuoteVolume: 500000,
    candidateLimit: 400,
  },
  UNIVERSE_ABOVE_MA80_1D: {
    ruleType: 'ABOVE_MA',
    maPeriod: 80,
    minDistancePct: null,
    maxDistancePct: null,
    timeframe: '1d',
    minQuoteVolume: 500000,
    candidateLimit: 400,
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

export function getBuiltinScanDefinition(code: string): UniverseScanDefinition | null {
  const resolved =
    code === 'UNIVERSE_NEAR_MA200_PCT4_1H' ? UNIVERSE_CODE_SCANNER_3_MA80_PCT4 : code;
  return BUILTIN_UNIVERSE_SCAN[resolved] ?? null;
}

export const BUILTIN_UNIVERSE_META: Record<
  string,
  { displayName: string; description: string; strategyNames: string }
> = {
  UNIVERSE_ABOVE_MA200_1H: {
    displayName: 'Scanner 1 — Acima SMA200 (1h)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA200 em 1h. Universo: MA Cross 15m, Pivot Boss Bear 15m e Afastamento médio 30m.',
    strategyNames: 'MA_CROSS_5M, PIVOT_BOSS_BEAR_15M, AFASTAMENTO_MEDIO_30M',
  },
  UNIVERSE_NEAR_MA200_PCT10_1H: {
    displayName: `Scanner 2 — ${SCANNER_2_EMA80_BAND_LABEL}`,
    description:
      'Preço entre -5% e +15% da EMA80 em 1h. Universo: RSI queda de 70 legado e RSI pullback bear.',
    strategyNames: 'RSI_OVERBOUGHT_DROP_1H, RSI_OVERBOUGHT_DROP_LEGACY_1H',
  },
  UNIVERSE_NEAR_MA200_PCT4_4H: {
    displayName: 'Scanner 3 — Até ±4% da MA80 (4h)',
    description:
      'Preço dentro de ±4% da MA80 em 4h. Universo: Afastamento médio 1h.',
    strategyNames: 'AFASTAMENTO_MEDIO',
  },
  UNIVERSE_ABOVE_MA200_1D: {
    displayName: 'Scanner 4 — Acima SMA200 (1d)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA200 em velas diárias (1d). Universo: Pivot Boss Bear 1h e EMA Ribbon BUY 15m.',
    strategyNames: 'PIVOT_BOSS_BEAR_1H, EMA_SCALPING',
  },
  UNIVERSE_ABOVE_MA80_1D: {
    displayName: 'Scanner 5 — Acima SMA80 (1d)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA80 em velas diárias (1d). Universo: estratégia Top 6 (excl. ranks 2–3).',
    strategyNames: 'SCANNER_MA80_TOP6',
  },
  UNIVERSE_ABOVE_MA80_4H: {
    displayName: 'Scanner 6 — Acima SMA80 (4h)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA80 em velas 4h. Universo: estratégia Top 6 (excl. ranks 3–6, rotação 4h).',
    strategyNames: 'SCANNER_MA80_4H_TOP6',
  },
};

/** Rotas UI `/scanners/1` … `/scanners/6` */
export const SCANNER_UI_ROUTES = [
  { scannerId: '1', code: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 },
  { scannerId: '2', code: UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 },
  { scannerId: '3', code: UNIVERSE_CODE_SCANNER_3_MA80_PCT4 },
  { scannerId: '4', code: UNIVERSE_CODE_SCANNER_4_ABOVE_MA200_1D },
  { scannerId: '5', code: UNIVERSE_CODE_SCANNER_5_ABOVE_MA80_1D },
  { scannerId: '6', code: UNIVERSE_CODE_SCANNER_6_ABOVE_MA80_4H },
] as const;

export function getScannerByUiId(scannerId: string) {
  return SCANNER_UI_ROUTES.find((s) => s.scannerId === scannerId) ?? null;
}
