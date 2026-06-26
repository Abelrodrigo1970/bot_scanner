import { REMOVED_DEPRECATED_STRATEGY_NAMES } from './strategyMigrations';

import { DEPRECATED_TOP_ROTATION_NAMES } from './ensureMissingBuiltinStrategies';



/** Ordem de apresentação na página Estratégias (só activas). */

export const ACTIVE_STRATEGY_DISPLAY_ORDER = [

  'MA_CROSS_5M',

  'SCANNER1_TOP5',

  'PIVOT_BOSS_BEAR_15M',

  'ACCUMULATION_BREAKOUT_15M',

  'EMA80_SMA7_BREAKDOWN_15M',

  'SCANNER2_SHORT_LEADER_24H',

] as const;



/** Estratégias activas no bot_scanner (Scanner 1). */

export const ACTIVE_SCANNER_STRATEGY_NAMES = ACTIVE_STRATEGY_DISPLAY_ORDER;



export interface StrategyCatalogEntry {

  cron: '15m' | '1h';

  cronLabel: string;

  timeframe: string;

  universe?: string;

}



export const STRATEGY_CATALOG: Record<string, StrategyCatalogEntry> = {

  MA_CROSS_5M: {

    cron: '15m',

    cronLabel: 'Cron 15m',

    timeframe: '15m',

    universe: 'Scanner 1 top 20 (acima SMA200, 1h)',

  },

  SCANNER1_TOP8: {

    cron: '1h',

    cronLabel: 'Rotação 4h (pós-scan)',

    timeframe: '4h',

    universe: 'Scanner 1 — ranks 1,2,5–8 (excl. #3 #4)',

  },

  SCANNER1_TOP5: {

    cron: '1h',

    cronLabel: 'Rotação 4h (pós-scan)',

    timeframe: '4h',

    universe: 'Scanner 2 — ranks 1–8 (top subidas 24h)',

  },

  PIVOT_BOSS_BEAR_15M: {

    cron: '15m',

    cronLabel: 'Cron 15m',

    timeframe: '15m',

    universe: 'Scanner 1 top 30 (acima SMA200, 1h)',

  },

  ACCUMULATION_BREAKOUT_15M: {

    cron: '15m',

    cronLabel: 'Cron 15m',

    timeframe: '15m',

    universe: 'Scanner 1 ranks 11–40 (acima SMA200, 1h); força máx. 75',

  },

  EMA80_SMA7_BREAKDOWN_15M: {

    cron: '15m',

    cronLabel: 'Cron 15m',

    timeframe: '15m',

    universe: 'Scanner 1 top 50 (acima SMA200, 1h)',

  },

  SCANNER2_SHORT_LEADER_24H: {

    cron: '1h',

    cronLabel: 'Rotação 4h (pós-scan)',

    timeframe: '4h',

    universe: 'Scanner 2 — ranks #1–#2; pump ≥50%',

  },

};



export const REMOVED_STRATEGY_LABELS: Record<string, string> = {

  SCANNER_S6_SHORT_LEADER_12H: 'Scanner 6 Short Leader 12h (substituído por Scanner 2 Short Leader 24h)',

  SCANNER1_TOP8: 'Scanner 1 Top 6 (rotação — descontinuado)',

  SCANNER3_RSI_BREAKOUT_15M: 'Scanner 3 RSI Rompimento 15m (descontinuado)',

  SCANNER_MA80_TOP6: 'Scanner 5 Top 6 (rotação — bot_cripto)',

  SCANNER_MA80_4H_TOP6: 'Scanner 6 Top 6 (rotação — bot_cripto)',

  MA_VOLATILE: 'MA Cross Top Voláteis',

  MA200_VOLATILE: 'MA200 Top Voláteis (4h)',

  MACD_HISTOGRAM_PMO: 'MACD Histogram 1h + PMO',

  AFASTAMENTO_MEDIO: 'Afastamento médio 1h',

  AFASTAMENTO_MEDIO_30M: 'Afastamento médio 30m',

  EMA_SCALPING: 'EMA Ribbon Scalping BUY (15m)',

  EMA_SCALPING_SELL: 'EMA Ribbon Scalping SELL 15m (descontinuado)',

  RSI: 'RSI 1h',

  RSI_15M: 'RSI 15m',

  RSI_BYBIT_15M: 'RSI Bybit 15m',

  RSI_OVERBOUGHT_DROP_1H: 'RSI pullback bear 1h',

  RSI_OVERBOUGHT_DROP_LEGACY_1H: 'RSI queda de 70 (mín. 4 pts) + afastamento >10% (1h)',

  PIVOT_BOSS_BEAR_1H: 'Pivot Boss Bear 1h (4 EMA venda)',

  VOLUME_SPIKE: 'Volume Spike 1h',

  MA_CROSS_15M: 'MA Cross 15m (legado)',

  MA_CROSS_1H: 'MA Cross 1h',

  VOLUME_SPIKE_15M: 'Volume Spike 15m (→ MA Cross 15m)',

};



const removedSet = new Set<string>(REMOVED_DEPRECATED_STRATEGY_NAMES as readonly string[]);

removedSet.add('VOLUME_SPIKE_15M');

for (const n of DEPRECATED_TOP_ROTATION_NAMES) {

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



export const CRON_GROUPS: { key: '15m' | '1h'; title: string; description: string }[] = [

  {

    key: '15m',

    title: 'Cron 15m',

    description: 'MA Cross 12×30 (15m) + Pivot Boss Bear 15m',

  },

  {

    key: '1h',

    title: 'Rotação 4h',

    description: 'Scanner 2 Top 8 + Scanner 2 Short ranks #1–#2 (após run-universe-scans)',

  },

];


