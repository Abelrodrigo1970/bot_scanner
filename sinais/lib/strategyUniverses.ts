/**

 * Mapa estratégia → universo de símbolos (estratégias de sinal).

 */



export type UniverseSourceKind =

  | 'runtime_top_movers_1h'

  | 'runtime_top_volume'

  | 'table'

  | 'universe_scan'

  | 'fixed_symbol';



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

    dataKey: 'UNIVERSE_RSI_ABOVE_75_1H',

    description: 'Scanner 3: RSI 14 (1h) ≥ 75. MA12/MA30 em 15m.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'MA_CROSS_12X21_S2',

    displayLabel: 'MA Cross 12×21 (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_MA80_4H',

    description: 'Scanner 6: fecho acima SMA80 (4h). MA12/MA21 em 15m; só COMPRA; spread 0,6–1,5%.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'ROMPIMENTO_20_15M',

    displayLabel: 'Rompimento 20 (15m)',

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_EMA70_1D',

    description:
      'Scanner 1 top 50. LONG 15m: fecho > máximo das 20 velas anteriores. Sem sinal se preço >30% acima EMA70. Stoch K 50/40/11: %K < 30. SL −5%. TP1 +9% (50%). Restante 24h.',

    refresh: '/api/cron/run-universe-scans (cada 4 h)',

  },

  {

    strategyName: 'RUMERS_BOX_15M',

    displayLabel: "Rumer's Box (15m)",

    signalTimeframes: ['15m'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_EMA70_1D',

    description:
      "Scanner 1 top 50. Só BUY: cruzamento PDH (vela ant. dentro da caixa). SL −12%. TP1 +65% (50%). Restante às 72h.",

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

    dataKey: 'UNIVERSE_ABOVE_EMA70_1D',

    description:
      'Scanner 1. LONG ao entrar/reentrar com fecho 4h > EMA21 + 0,8%. Sai ao sair do scanner ou fecho < EMA21. SL −8%. Sem TP.',

    refresh: '/api/cron/run-15m (rsi_vendido só de 4em4h Lisboa)',

  },

  {

    strategyName: 'RSI_1H_LONG',

    displayLabel: 'rsi_1h_long',

    signalTimeframes: ['1h'],

    source: 'universe_scan',

    dataKey: 'UNIVERSE_ABOVE_EMA70_1D',

    description:
      'Scanner 1 completo. LONG 1h: fecho cruza EMA12↑ + RSI azul < 40 + dist EMA70 1d < 40%. TP +19%@30% +39%@50% | resto 72h | SL −7%.',

    refresh: '/api/cron/run-15m (1.º quarto de hora Lisboa)',

  },

  {

    strategyName: 'RSI_QQQ',

    displayLabel: 'rsi_qqq',

    signalTimeframes: ['1h'],

    source: 'fixed_symbol',

    dataKey: 'top30_stocks+QQQ',

    description:
      'Top 30 Bybit stocks + QQQUSDT. LONG 1h: RSI SMA18 ↑34 · TP +2%@50% +5%@50% | SL −4%. SHORT: EMA20↓EMA70 · TP −5% | SL +6% | fecha no LONG.',

    refresh: '/api/cron/run-15m (1.º quarto de hora Lisboa)',

  },

];



export const DATA_SOURCE_MENU_ITEMS = [
  {
    href: '/scanners/1',
    label: 'Scanner 1 — Acima EMA70 (1d) (Rumer\'s Box, rsi_vendido, rsi_1h_long)',
  },
  {
    href: '/scanners/2',
    label: 'Scanner 2 — Top 30 subidas 24h (rotação Top 4)',
  },
  {
    href: '/scanners/3',
    label: 'Scanner 3 — RSI > 75 (1h) (MA Cross 12×30)',
  },
  {
    href: '/scanners/6',
    label: 'Scanner 6 — Acima SMA80 4h (MA 12×21, VWAP, Rompimento)',
  },
  {
    href: '/scanners/7',
    label: 'Scanner 7 — RSI > 69 (1d) (engolfo, Liquidity Pools)',
  },
  {
    href: '/scanners/8',
    label: 'Scanner 8 — Bybit Stocks (%24h / 1s / EMA21 / EMA70)',
  },
  {
    href: '/scanners/lateral_volatile',
    label: 'Lateral — |EMA21−EMA70| < 10% (4h, 15 dias)',
  },
  {
    href: '/scanners/rumers_bands',
    label: "Rumer's Box — perto das bandas PDH/PDL (≤1%)",
  },
  {
    href: '/scanners/ytd_mcap60',
    label: 'YTD — Top 50 (mcap > $60M)',
  },
  {
    href: '/scanners/price_range',
    label: 'Preço $0.65–$0.80 (todos os perps na faixa)',
  },
] as const;


