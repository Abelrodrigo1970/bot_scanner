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

    dataKey: 'UNIVERSE_RSI_ABOVE_69_1D',

    description: 'Scanner 7: RSI 14 (1d) ≥ 69. MA12/MA21 em 15m; só COMPRA; spread 0,6–1,5%.',

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

    strategyName: 'LIQUIDITY_POOLS_PRO_15M',

    displayLabel: 'Liquidity Pools (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description:
      'Scanner 2 top 15. Sweep de liquidez 15m (mitigation). SL 1,5×ATR. TP 1R/2R/3R (33%/33%/resto 24h).',

    refresh: '/api/cron/run-15m (cada 15 min)',

  },

  {

    strategyName: 'SWING_ANCHORED_VWAP_15M',

    displayLabel: 'Swing Anchored VWAP (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_TOP30_PRICE_CHANGE_24H',

    description:
      'Scanner 2 top 15. Cruzamento linha azul hVwap (length 50): BUY acima, SELL abaixo. SL swing ±0,5% ou 5%. TP1 10% (50%). Resto 24h.',

    refresh: '/api/cron/run-15m (cada 15 min)',

  },

  {

    strategyName: 'ROMPIMENTO_20_15M',

    displayLabel: 'Rompimento 20 (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA200_1H',

    description:
      'Scanner 1 top 20. LONG 15m: fecho > máximo das 20 velas anteriores. Sem sinal se preço >30% acima EMA70. Stoch K 50/40/11: %K < 30. SL −5%. TP1 +9% (50%). Restante 24h.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

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

    displayLabel: 'rsi_vendido LONG (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA80_4H',

    description:
      'Scanner 6. LONG se RSI(14) 15m fecha <28. SL −5%. TP1 +10% 30% | TP2 +48% 30%. Restante: RSI×SMA14 down com RSI>65.',

    refresh: '/api/cron/run-15m (e run-rsi-vendido)',

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
    label: 'Scanner 6 — Acima SMA80 4h (rsi_vendido 15m)',
  },
  {
    href: '/scanners/7',
    label: 'Scanner 7 — RSI > 69 (1d)',
  },
  {
    href: '/scanners/lateral_volatile',
    label: 'Lateral — |EMA21−EMA70| < 10% (4h, 15 dias)',
  },
  {
    href: '/scanners/ytd_mcap60',
    label: 'YTD — Top 50 (mcap > $60M)',
  },
] as const;


