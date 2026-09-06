/**
 * Listas de nomes de estratégias — sem imports de DB/Node.
 * Usado por strategyCatalog (páginas client) e por sync/seed no servidor.
 */

/** Estratégias retiradas (não recriar no seed / apagar da BD em produção). */
export const REMOVED_DEPRECATED_STRATEGY_NAMES = [
  'VOLUME_SPIKE',
  'RSI',
  'RSI_15M',
  'RSI_BYBIT_15M',
  'MA_CROSS_15M',
  'MA_CROSS_1H',
  'MA_VOLATILE',
  'AFASTAMENTO_MEDIO',
  'AFASTAMENTO_MEDIO_30M',
  'MA200_VOLATILE',
  'MACD_HISTOGRAM_PMO',
  'EMA_SCALPING',
  'EMA_SCALPING_SELL',
  'RSI_OVERBOUGHT_DROP_1H',
  'RSI_OVERBOUGHT_DROP_LEGACY_1H',
  'PIVOT_BOSS_BEAR_1H',
  'STCH15LONG',
  'SCANNER2_RSI80_TOP3_LONG_4H',
] as const;

/** Estratégias descontinuadas — manter registo/histórico, sem trading. */
export const DISCONTINUED_STRATEGY_NAMES = [
  'PIVOT_BOSS_BEAR_15M',
  'ACCUMULATION_BREAKOUT_15M',
  'EMA80_SMA7_BREAKDOWN_15M',
  'SCANNER2_SHORT_LEADER_24H',
  'SCANNER3_RSI_FLIP_1H',
  'SCANNER2_STOCH_RSI_5M',
  'SCANNER1_TOP5',
  'SCANNER3_RSI_BREAKOUT_15M',
  'STCH15LONG',
  'SCANNER2_RSI80_TOP3_LONG_4H',
] as const;

/** Rotações Top descontinuadas neste projeto. */
export const DEPRECATED_TOP_ROTATION_NAMES = [
  'SCANNER_MA80_TOP6',
  'SCANNER_MA80_4H_TOP6',
  'SCANNER1_TOP8',
] as const;

/** @deprecated Use DEPRECATED_TOP_ROTATION_NAMES */
export const TOP_ROTATION_STRATEGY_NAMES = DEPRECATED_TOP_ROTATION_NAMES;
