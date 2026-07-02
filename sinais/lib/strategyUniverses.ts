/**

 * Mapa estratégia → universo de símbolos (estratégias de sinal).

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

  dataKey: string;

  description: string;

  refresh?: string;

}



export const ACTIVE_STRATEGY_UNIVERSES: StrategyUniverseSpec[] = [

  {

    strategyName: 'MA_CROSS_5M',

    displayLabel: 'MA Cross 12×30 (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA200_1H',

    description: 'Scanner 1: fecho acima SMA200 (1h).',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'PIVOT_BOSS_BEAR_15M',

    displayLabel: 'Pivot Boss Bear 15m (4 EMA venda)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA200_1H',

    description: 'Scanner 1 top 30 (|pct vs SMA200|); sinais em 15m.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'ACCUMULATION_BREAKOUT_15M',

    displayLabel: 'Rompimento de Acumulação 15m',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA200_1H',

    description: 'Scanner 1 ranks 11–40 (|pct vs SMA200|); sinais em 15m.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'SCANNER1_TOP5',

    displayLabel: 'Scanner 2 Top 4 (rotação 4h)',

    signalTimeframes: ['4h'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description: 'Scanner 2: top 30 subidas 24h; rotação ranks 1–8 após cada scan.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'EMA80_SMA7_BREAKDOWN_15M',

    displayLabel: 'Quebra EMA80 (SMA7>EMA80) 15m',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA200_1H',

    description: 'Scanner 1 top 50; VENDA quando preço < EMA80 e SMA(7) > EMA80.',

    refresh: '/api/cron/run-15m (cada 15 min)',

  },

  {

    strategyName: 'SCANNER2_SHORT_LEADER_24H',

    displayLabel: 'Scanner 2 Short Leader 24h',

    signalTimeframes: ['4h'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description: 'SHORT rank #2 Scanner 2 (top subidas 24h); pump 50–90%; fecho 24h; bloqueio 10–14h PT.',

    refresh: '/api/cron/run-universe-scans (cada 4 h) + run-scanner2-short-leader-24h',

  },

];



export const DATA_SOURCE_MENU_ITEMS = [
  {
    href: '/scanners/1',
    label: 'Scanner 1 — Acima SMA200 (MA Cross, Pivot Boss, Rompimento, rotações)',
  },
  {
    href: '/scanners/2',
    label: 'Scanner 2 — Top 30 subidas 24h (rotação Top 4)',
  },
  {
    href: '/scanners/3',
    label: 'Scanner 3 — RSI > 75 (15m)',
  },
  {
    href: '/scanners/6',
    label: 'Scanner 6 — Acima SMA80 4h (SHORT rank #1)',
  },
] as const;


