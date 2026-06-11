import { REMOVED_DEPRECATED_STRATEGY_NAMES } from './strategyMigrations';

/** Ordem de apresentação na página Estratégias (só activas). */
export const ACTIVE_STRATEGY_DISPLAY_ORDER = [
  'MA_CROSS_5M',
  'SCANNER1_TOP8',
  'SCANNER_MA80_TOP6',
  'PIVOT_BOSS_BEAR_15M',
  'EMA_SCALPING',
  'AFASTAMENTO_MEDIO_30M',
  'RSI_OVERBOUGHT_DROP_1H',
  'RSI_OVERBOUGHT_DROP_LEGACY_1H',
  'PIVOT_BOSS_BEAR_1H',
] as const;

export interface StrategyCatalogEntry {
  cron: '15m' | '30m' | '1h';
  cronLabel: string;
  timeframe: string;
  universe?: string;
}

/** Metadados de cron / universo para cartões na UI. */
export const STRATEGY_CATALOG: Record<string, StrategyCatalogEntry> = {
  MA_CROSS_5M: {
    cron: '15m',
    cronLabel: 'Cron 15m',
    timeframe: '15m',
    universe: 'Scanner 1 (acima SMA200, 1h)',
  },
  SCANNER1_TOP8: {
    cron: '1h',
    cronLabel: 'Rotação 4h (pós-scan)',
    timeframe: '4h',
    universe: 'Scanner 1 — ranks 1,2,5–8 (excl. #3 #4)',
  },
  SCANNER_MA80_TOP6: {
    cron: '1h',
    cronLabel: 'Rotação diária (pós-scan)',
    timeframe: '1d',
    universe: 'Scanner 5 — ranks 1,4–8 (excl. #2 #3)',
  },
  PIVOT_BOSS_BEAR_15M: {
    cron: '1h',
    cronLabel: 'Cron 1h (velas 15m)',
    timeframe: '15m',
    universe: 'Scanner 1 (acima SMA200, 1h)',
  },
  EMA_SCALPING: {
    cron: '15m',
    cronLabel: 'Cron 15m',
    timeframe: '15m',
    universe: 'Scanner 4 (acima SMA200, 1d)',
  },
  EMA_SCALPING_SELL: {
    cron: '15m',
    cronLabel: 'Cron 15m (legado)',
    timeframe: '15m',
    universe: 'Top movers 1h',
  },
  AFASTAMENTO_MEDIO_30M: {
    cron: '30m',
    cronLabel: 'Cron 30m',
    timeframe: '30m',
    universe: 'Scanner 1 (acima SMA200, 1h)',
  },
  RSI_OVERBOUGHT_DROP_1H: {
    cron: '1h',
    cronLabel: 'Cron 1h',
    timeframe: '1h',
    universe: 'Scanner 2 (-5% a +15% EMA80, 1h)',
  },
  RSI_OVERBOUGHT_DROP_LEGACY_1H: {
    cron: '1h',
    cronLabel: 'Cron 1h',
    timeframe: '1h',
    universe: 'Scanner 2 (-5% a +15% EMA80, 1h)',
  },
  PIVOT_BOSS_BEAR_1H: {
    cron: '1h',
    cronLabel: 'Cron 1h',
    timeframe: '1h',
    universe: 'Scanner 4 (acima SMA200, 1d)',
  },
};

/** Rótulos legíveis das estratégias descontinuadas (referência na UI). */
export const REMOVED_STRATEGY_LABELS: Record<string, string> = {
  MA_VOLATILE: 'MA Cross Top Voláteis',
  MA200_VOLATILE: 'MA200 Top Voláteis (4h)',
  MACD_HISTOGRAM_PMO: 'MACD Histogram 1h + PMO',
  AFASTAMENTO_MEDIO: 'Afastamento médio 1h',
  EMA_SCALPING_SELL: 'EMA Ribbon Scalping SELL 15m (descontinuado)',
  RSI: 'RSI 1h',
  RSI_15M: 'RSI 15m',
  RSI_BYBIT_15M: 'RSI Bybit 15m',
  VOLUME_SPIKE: 'Volume Spike 1h',
  MA_CROSS_15M: 'MA Cross 15m (legado)',
  MA_CROSS_1H: 'MA Cross 1h',
  VOLUME_SPIKE_15M: 'Volume Spike 15m (→ MA Cross 15m)',
};

const removedSet = new Set<string>(REMOVED_DEPRECATED_STRATEGY_NAMES as readonly string[]);
removedSet.add('VOLUME_SPIKE_15M');

export function isDeprecatedStrategyName(name: string): boolean {
  return removedSet.has(name);
}

export function sortActiveStrategies<T extends { name: string }>(items: T[]): T[] {
  const order = new Map(ACTIVE_STRATEGY_DISPLAY_ORDER.map((n, i) => [n, i]));
  return [...items].sort((a, b) => {
    const ia = order.get(a.name as (typeof ACTIVE_STRATEGY_DISPLAY_ORDER)[number]) ?? 999;
    const ib = order.get(b.name as (typeof ACTIVE_STRATEGY_DISPLAY_ORDER)[number]) ?? 999;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  });
}

export const CRON_GROUPS: { key: '15m' | '30m' | '1h'; title: string; description: string }[] = [
  {
    key: '15m',
    title: 'Cron 15m',
    description: 'MA Cross 15m, EMA Ribbon SELL 15m',
  },
  {
    key: '30m',
    title: 'Cron 30m',
    description: 'Afastamento médio 30m',
  },
  {
    key: '1h',
    title: 'Cron 1h',
    description: 'RSI, Pivot Boss 15m/1h',
  },
];
