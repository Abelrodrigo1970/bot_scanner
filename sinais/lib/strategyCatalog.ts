import { REMOVED_DEPRECATED_STRATEGY_NAMES } from './strategyMigrations';
import { TOP_ROTATION_STRATEGY_NAMES } from './ensureMissingBuiltinStrategies';

/** Ordem de apresentação na página Estratégias (só activas). */
export const ACTIVE_STRATEGY_DISPLAY_ORDER = [
  'MA_CROSS_5M',
  'PIVOT_BOSS_BEAR_15M',
  'EMA_SCALPING',
  'AFASTAMENTO_MEDIO_30M',
  'RSI_OVERBOUGHT_DROP_1H',
  'RSI_OVERBOUGHT_DROP_LEGACY_1H',
  'PIVOT_BOSS_BEAR_1H',
] as const;

/** Estratégias activas (sinais baseados em scanners 1, 2 e 4). */
export const ACTIVE_SCANNER_STRATEGY_NAMES = ACTIVE_STRATEGY_DISPLAY_ORDER;

export interface StrategyCatalogEntry {
  cron: '15m' | '30m' | '1h';
  cronLabel: string;
  timeframe: string;
  universe?: string;
}

export const STRATEGY_CATALOG: Record<string, StrategyCatalogEntry> = {
  MA_CROSS_5M: {
    cron: '15m',
    cronLabel: 'Cron 15m',
    timeframe: '15m',
    universe: 'Scanner 1 (acima SMA200, 1h)',
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

export const REMOVED_STRATEGY_LABELS: Record<string, string> = {
  SCANNER1_TOP8: 'Scanner 1 Top 6 (rotação — bot_cripto)',
  SCANNER_MA80_TOP6: 'Scanner 5 Top 6 (rotação — bot_cripto)',
  SCANNER_MA80_4H_TOP6: 'Scanner 6 Top 6 (rotação — bot_cripto)',
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
for (const n of TOP_ROTATION_STRATEGY_NAMES) {
  removedSet.add(n);
}

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
    description: 'MA Cross 15m, EMA Ribbon BUY 15m',
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
