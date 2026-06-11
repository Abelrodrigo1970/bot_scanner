/**
 * Mapa estratégia → universo de símbolos (fonte de dados).
 * Usado para documentação e para alinhar crons / menu «Origem de dados».
 */

export type UniverseSourceKind =
  | 'runtime_top_movers_1h'
  | 'runtime_top_volume'
  | 'table'
  | 'universe_scan';

export interface StrategyUniverseSpec {
  strategyName: string;
  displayLabel: string;
  signalTimeframes: string[];
  source: UniverseSourceKind;
  /** Tabela Prisma, código UniverseScanRun, ou descrição runtime */
  dataKey: string;
  description: string;
  /** Cron ou acção manual que alimenta a BD */
  refresh?: string;
}

/** Estratégias activas no seed + importadas (exclui descontinuadas). */
export const ACTIVE_STRATEGY_UNIVERSES: StrategyUniverseSpec[] = [
  {
    strategyName: 'MA_CROSS_5M',
    displayLabel: 'MA Cross 15m (MA12/MA30)',
    signalTimeframes: ['15m'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1H',
    description: 'Scanner 1: fecho acima SMA200 (1h).',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'SCANNER1_TOP8',
    displayLabel: 'Scanner 1 Top 6 (excl. ranks 3–4)',
    signalTimeframes: ['4h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1H',
    description: '6 posições: ranks 1, 2, 5–8 do Scanner 1 (exclui #3 e #4); rotação total a cada scan.',
    refresh: '/api/cron/run-universe-scans (cada 4 h) + run-scanner1-top8',
  },
  {
    strategyName: 'SCANNER_MA80_TOP6',
    displayLabel: 'Scanner 5 Top 6 (excl. ranks 2–3)',
    signalTimeframes: ['1d'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA80_1D',
    description: '6 posições: ranks 1, 4–8 do Scanner 5 (exclui #2 e #3); rotação total 1×/dia UTC.',
    refresh: '/api/cron/run-universe-scans (cada 4 h) + run-scanner-ma80-top6 (diário)',
  },
  {
    strategyName: 'SCANNER_MA80_4H_TOP6',
    displayLabel: 'Scanner 6 Top 6 (excl. ranks 3–6)',
    signalTimeframes: ['4h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA80_4H',
    description: '6 posições: ranks 1, 2, 4, 5, 7, 8 do Scanner 6 (exclui #3 e #6); rotação total a cada scan.',
    refresh: '/api/cron/run-universe-scans (cada 4 h) + run-scanner-ma80-4h-top6',
  },
  {
    strategyName: 'EMA_SCALPING',
    displayLabel: 'EMA Ribbon Scalping BUY (15m)',
    signalTimeframes: ['15m'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1D',
    description: 'Scanner 4: fecho acima SMA200 (1d); sinais em 15m.',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'PIVOT_BOSS_BEAR_15M',
    displayLabel: 'Pivot Boss Bear 15m (4 EMA venda)',
    signalTimeframes: ['15m'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1H',
    description: 'Scanner 1: fecho acima SMA200 (1h); sinais em 15m.',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'PIVOT_BOSS_BEAR_1H',
    displayLabel: 'Pivot Boss Bear 1h (4 EMA venda)',
    signalTimeframes: ['1h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1D',
    description: 'Scanner 4: fecho acima SMA200 (1d); sinais em 1h.',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'RSI_OVERBOUGHT_DROP_1H',
    displayLabel: 'RSI pullback bear 1h',
    signalTimeframes: ['1h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_NEAR_MA200_PCT10_1H',
    description: 'Scanner 2: -5% a +15% da EMA80 (1h).',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'RSI_OVERBOUGHT_DROP_LEGACY_1H',
    displayLabel: 'RSI queda de 70 (mín. 4 pts) + afastamento >10% (1h)',
    signalTimeframes: ['1h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_NEAR_MA200_PCT10_1H',
    description: 'Scanner 2: -5% a +15% da EMA80 (1h).',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'AFASTAMENTO_MEDIO_30M',
    displayLabel: 'Afastamento médio 30m',
    signalTimeframes: ['30m'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1H',
    description: 'Scanner 1: fecho acima SMA200 (1h); sinais em 30m.',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
];

/** Rotas do menu «Origem de dados» alinhadas a universos em uso. */
export const DATA_SOURCE_MENU_ITEMS = [
  {
    href: '/bybit-ma200-mc20m',
    label: 'Bybit Vol 1h + MA200 → MA12×MA30',
  },
  {
    href: '/scanners/1',
    label: 'Scanner 1 — Acima SMA200 (MA Cross + Pivot Boss 15m + Afastamento 30m)',
  },
  {
    href: '/scanners/2',
    label: 'Scanner 2 — -5% a +15% EMA80 (RSI legado + RSI pullback bear)',
  },
  {
    href: '/scanners/3',
    label: 'Scanner 3 — ±4% MA80 (4h, Afastamento 1h)',
  },
  {
    href: '/scanners/4',
    label: 'Scanner 4 — Acima SMA200 (Pivot Boss 1h + MA200 4h + EMA Ribbon BUY 15m)',
  },
  {
    href: '/scanners/5',
    label: 'Scanner 5 — Acima SMA80 (1d, Top 6 excl. ranks 2–3)',
  },
  {
    href: '/scanners/6',
    label: 'Scanner 6 — Acima SMA80 (4h, Top 6 excl. ranks 3–6)',
  },
] as const;
