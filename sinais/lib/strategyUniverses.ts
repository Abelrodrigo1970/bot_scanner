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

    description: 'Scanner 1: fecho acima SMA200 (1h); sinais em 15m.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

];



export const DATA_SOURCE_MENU_ITEMS = [
  {
    href: '/scanners/1',
    label: 'Scanner 1 — Acima SMA200 (MA Cross + Pivot Boss + Top 6)',
  },
  {
    href: '/scanners/2',
    label: 'Scanner 2 — Top 30 volume 24h',
  },
] as const;


