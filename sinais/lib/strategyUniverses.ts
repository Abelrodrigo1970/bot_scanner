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

    strategyName: 'MA_CROSS_12X21_S2',

    displayLabel: 'MA Cross 12×21 (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description: 'Scanner 2 top 30: maior subida 24h. MA12/MA21 em 15m.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'ENGOLFO_15M',

    displayLabel: 'engolfo',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description:
      'Scanner 2 top 3. SELL 15m: EMA12<EMA21 OU |EMA12−EMA21|<2%, fecho −1%+ vs vela ant. SL +8%. TP1 −20% (50%). Restante 24h.',

    refresh: '/api/cron/run-15m (cada 15 min)',

  },

  {

    strategyName: 'ROMPIMENTO_20_15M',

    displayLabel: 'Rompimento 20 (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA200_1H',

    description:
      'Scanner 1 top 20. LONG 15m: fecho > máximo das 20 velas anteriores. SL −7%. TP1 +45% (50%). Restante 24h.',

    refresh: '/api/cron/run-15m (cada 15 min)',

  },

  {

    strategyName: 'STCH15LONG',

    displayLabel: 'stch15long',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description:
      'Top 2 Scanner 2. Stochastic 15m (20/15/11): K×D up → LONG SL −5%; K×D down → fecha LONG. Só LONG. Cron 5m.',

    refresh: '/api/cron/run-5m (cada 5 min)',

  },

  {

    strategyName: 'SCANNER2_RSI80_TOP3_LONG_4H',

    displayLabel: 'Scanner 2 RSI>80 Top 3 LONG (4h)',

    signalTimeframes: ['4h'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description:
      'Top 3 Scanner 2 (exclui #4). LONG se RSI(14) 4h cruza >80. SL −10%. Fecho 24h. Sem TP.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'RSI_VENDIDO_4H',

    displayLabel: 'rsi_vendido LONG (4h)',

    signalTimeframes: ['4h'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_RSI_BELOW_32_4H',

    description:
      'rsi_vendido. LONG se RSI(14) 4h cruza <25. SL −5%. Sai quando RSI cruza >32 (ou 24h). Só LONG.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

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
    label: 'Scanner 3 — RSI > 75 (1h)',
  },
  {
    href: '/scanners/6',
    label: 'Scanner 6 — Acima SMA80 4h (SHORT rank #1)',
  },
  {
    href: '/scanners/rsi_vendido',
    label: 'rsi_vendido — RSI < 32 (4h)',
  },
  {
    href: '/scanners/lateral_volatile',
    label: 'Lateral — |EMA21−EMA70| < 10% (4h, 15 dias)',
  },
] as const;


