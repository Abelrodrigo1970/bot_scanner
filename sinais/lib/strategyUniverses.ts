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
    strategyName: 'MA200_VOLATILE',
    displayLabel: 'MA200 Top Voláteis',
    signalTimeframes: ['4h'],
    source: 'runtime_top_volume',
    dataKey: 'fetchTopSymbolsByVolume',
    description: 'Top por volume 24h (param. symbolLimit / minQuoteVolume), sem tabela de universo.',
  },
  {
    strategyName: 'EMA_SCALPING_SELL',
    displayLabel: 'EMA Ribbon Scalping SELL (15m)',
    signalTimeframes: ['15m'],
    source: 'runtime_top_movers_1h',
    dataKey: 'fetchTopSymbolsBy1hPriceChange',
    description: 'Top movers 1h (limite symbolLimit nos params).',
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
    dataKey: 'UNIVERSE_NEAR_MA200_PCT10_1H',
    description: 'Scanner 2: ±10% da EMA80 (1h); sinais em 1h.',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'MACD_HISTOGRAM_PMO',
    displayLabel: 'MACD Histogram 1h + PMO',
    signalTimeframes: ['1h'],
    source: 'runtime_top_movers_1h',
    dataKey: 'fetchTopSymbolsBy1hPriceChange:50',
    description: 'Top 50 movers 1h (param. symbolLimit; vela fechada + PMO/MACD confirmados).',
  },
  {
    strategyName: 'RSI_OVERBOUGHT_DROP_1H',
    displayLabel: 'RSI pullback bear 1h',
    signalTimeframes: ['1h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_NEAR_MA200_PCT10_1H',
    description: 'Scanner 2: ±10% da EMA80 (1h).',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'RSI_OVERBOUGHT_DROP_LEGACY_1H',
    displayLabel: 'RSI queda de 70 (mín. 4 pts) + afastamento >10% (1h)',
    signalTimeframes: ['1h'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_ABOVE_MA200_1H',
    description: 'Scanner 1: fecho acima SMA200 (1h).',
    refresh: '/api/cron/run-universe-scans (cada 4 h)',
  },
  {
    strategyName: 'AFASTAMENTO_MEDIO_30M',
    displayLabel: 'Afastamento médio 30m',
    signalTimeframes: ['30m'],
    source: 'universe_scan',
    dataKey: 'UNIVERSE_NEAR_MA200_PCT4_4H',
    description: 'Scanner 3: ±4% da SMA80 (4h); sinais em 30m.',
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
    label: 'Scanner 1 — Acima SMA200 (MA Cross + RSI legado + Pivot Boss 15m)',
  },
  {
    href: '/scanners/2',
    label: 'Scanner 2 — ±10% EMA80 (RSI queda 70)',
  },
  {
    href: '/scanners/3',
    label: 'Scanner 3 — ±4% MA80 (4h, Afastamento 30m)',
  },
  {
    href: '/scanners/4',
    label: 'Scanner 4 — Acima SMA200 (1d)',
  },
] as const;
