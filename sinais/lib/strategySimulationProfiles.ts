/**
 * Perfis SL/TP canónicos para simulação em Estatísticas dos Resultados.
 * Alinhados com params/descrições em strategyMigrations, seed e motores de sinal.
 */

export interface StrategySimulationSide {
  stopLossPct: number;
  tp1Pct: number;
  tp2Pct: number;
  tp1PositionPct: number;
  tp2PositionPct: number;
  finalCloseHours: number;
}

export interface StrategySimulationProfile {
  /** Nome interno (opcional). */
  strategyName?: string;
  /** Nomes em Signal.strategyName (displayName na BD). */
  displayNames: string[];
  buy: StrategySimulationSide | null;
  sell: StrategySimulationSide | null;
  /** Texto curto para a tabela de referência. */
  summary: string;
}

const H24 = 24;

function side(
  sl: number,
  tp1: number,
  tp1Pos: number,
  tp2 = 0,
  tp2Pos = 0,
  hours = H24
): StrategySimulationSide {
  return {
    stopLossPct: sl,
    tp1Pct: tp1,
    tp2Pct: tp2,
    tp1PositionPct: tp1Pos,
    tp2PositionPct: tp2Pos,
    finalCloseHours: hours,
  };
}

export const STRATEGY_SIMULATION_PROFILES: StrategySimulationProfile[] = [
  {
    strategyName: 'MA_CROSS_5M',
    displayNames: ['MA Cross 12×30 (15m)', 'MA Cross 15m (MA12/MA30)', 'Volume Spike 15m'],
    buy: side(15, 44, 60),
    sell: side(15, 44, 60),
    summary:
      'SL 15%. TP1 ±44% (60% pos.). Restante: fecho dinâmico se spread MA12/MA30 < 0,5%.',
  },
  {
    strategyName: 'MA_CROSS_12X21_S2',
    displayNames: ['MA Cross 12×21 (15m)'],
    buy: side(15, 44, 60),
    sell: null,
    summary:
      'Scanner 7 (RSI 1d ≥ 69). Só COMPRA. Spread 0,6–1,5%. SL 15%. TP1 +44% (60% pos.). Restante: fecho dinâmico se spread MA12/MA21 < 0,5%. Sem tecto diário.',
  },
  {
    strategyName: 'ENGOLFO_15M',
    displayNames: ['engolfo'],
    buy: null,
    sell: side(10, 20, 50, 0, 0, 24),
    summary:
      'Scanner 2 top 3. Só VENDA. (EMA12<EMA21 OU |EMA12−EMA21|<2%) + fecho −1%+ vs vela ant. SL +8%. TP1 −20% (50%). Restante às 24h.',
  },
  {
    strategyName: 'LIQUIDITY_POOLS_PRO_15M',
    displayNames: ['Liquidity Pools (15m)'],
    buy: side(3, 3, 33, 6, 33, 24),
    sell: side(3, 3, 33, 6, 33, 24),
    summary:
      'Scanner 2 top 15. Sweep mitigation BSL/SSL. SL 1,5×ATR (preço no sinal). TP1/2/3 ≈ 1R/2R/3R (33%/33%/resto 24h).',
  },
  {
    strategyName: 'SWING_ANCHORED_VWAP_15M',
    displayNames: ['Swing Anchored VWAP (15m)'],
    buy: side(5, 10, 50, 0, 0, 24),
    sell: side(5, 10, 50, 0, 0, 24),
    summary:
      'Scanner 2 top 15. Flip trend length 50 (BigBeluga). BUY novo 50-bar high; SELL novo 50-bar low. SL swing ±0,5% ou 5%. TP1 VWAP activo ou 10% (50%). Resto 24h.',
  },
  {
    strategyName: 'ROMPIMENTO_20_15M',
    displayNames: ['Rompimento 20 (15m)'],
    buy: side(5, 9, 50, 0, 0, 24),
    sell: null,
    summary:
      'Scanner 1 top 20. Só COMPRA. Fecho > máx. 20 velas anteriores. Sem sinal se preço >30% acima EMA70. Stoch K 50/40/11: %K < 30. SL −5%. TP1 +9% (50%). Restante às 24h.',
  },
  {
    strategyName: 'PIVOT_BOSS_BEAR_15M',
    displayNames: ['Pivot Boss Bear 15m (4 EMA venda)'],
    buy: null,
    sell: side(7, 9, 50),
    summary:
      'DESCONTINUADA. Só VENDA. Stack 12/30/80/200 bearish. SL +7% fixo. TP1 -9% (50%) | restante às 24h.',
  },
  {
    strategyName: 'SCANNER1_TOP5',
    displayNames: ['Scanner 2 Top 4 (rotação 4h)'],
    buy: side(1, 0, 0, 0, 0, 24),
    sell: side(1, 0, 0, 0, 0, 24),
    summary: 'DESCONTINUADA. LONG top 4 (SL 1%) + SHORT saídas (SL 1%). Sem TP. Fecho SHORT 24h.',
  },
  {
    strategyName: 'SCANNER2_SHORT_LEADER_24H',
    displayNames: ['Scanner 2 Short Leader 24h'],
    buy: null,
    sell: side(25, 0, 0, 0, 0, 24),
    summary: 'DESCONTINUADA. SHORT rank #2 Scanner 2. Pump 50–90%. SL +25%. Fecho 24h.',
  },
  {
    strategyName: 'SCANNER2_STOCH_RSI_5M',
    displayNames: ['Scanner 2 Stoch RSI Top 4 (5m)'],
    buy: side(5, 0, 0, 0, 0, 0),
    sell: side(7, 0, 0, 0, 0, 0),
    summary:
      'DESCONTINUADA. Top 4 Scanner 2. Stoch RSI 5m. LONG K×D up SL −5%; SHORT pós-LONG se ≤MA21−1% SL +7%.',
  },
  {
    strategyName: 'STCH15LONG',
    displayNames: ['stch15long'],
    buy: side(5, 0, 0, 0, 0, 0),
    sell: null,
    summary:
      'DESCONTINUADA (Set 2026). Top 2 Scanner 2. Stoch 15m LONG. SL −5%. Fecha K×D down.',
  },
  {
    strategyName: 'SCANNER2_RSI80_TOP3_LONG_4H',
    displayNames: ['Scanner 2 RSI>80 Top 3 LONG (4h)'],
    buy: side(10, 0, 0, 0, 0, 24),
    sell: null,
    summary:
      'DESCONTINUADA (Set 2026). Top 3 Scanner 2 RSI 4h >80 LONG. SL −10%. Fecho 24h.',
  },
  {
    strategyName: 'RSI_VENDIDO_4H',
    displayNames: ['rsi_vendido LONG (4h)'],
    buy: side(5, 0, 0, 0, 0, 24),
    sell: null,
    summary:
      'DESCONTINUADA (Set 2026). rsi_vendido RSI 4h <25 LONG. SL −5%. Sai >32 ou 24h.',
  },
  {
    strategyName: 'SCANNER3_RSI_FLIP_1H',
    displayNames: ['Scanner 3 RSI Flip 15m', 'Scanner 3 RSI Flip 1h'],
    buy: side(5, 0, 0, 0, 0, 72),
    sell: side(5, 0, 0, 0, 0, 24),
    summary:
      'DESCONTINUADA. Scan 1h RSI>75 ranks 6–14. LONG 15m se RSI≥70; SHORT se RSI cruza <70.',
  },
  {
    strategyName: 'SCANNER3_RSI_BREAKOUT_15M',
    displayNames: ['Scanner 3 RSI Rompimento 1h', 'Scanner 3 RSI Rompimento 15m'],
    buy: side(7, 10.5, 50),
    sell: null,
    summary: 'DESCONTINUADA. Só COMPRA. Velas 1h. SL -7%. TP1 R×1,5 (~10,5%, 50% pos.).',
  },
];

export function findStrategySimulationProfile(
  strategyDisplayName: string
): StrategySimulationProfile | null {
  const n = strategyDisplayName.trim().toLowerCase();
  if (!n) return null;
  return (
    STRATEGY_SIMULATION_PROFILES.find((p) =>
      p.displayNames.some((d) => d.toLowerCase() === n)
    ) ??
    STRATEGY_SIMULATION_PROFILES.find((p) =>
      p.displayNames.some(
        (d) => n.includes(d.toLowerCase()) || d.toLowerCase().includes(n)
      )
    ) ??
    null
  );
}

export function getSimulationSideForSignal(
  strategyDisplayName: string,
  direction: 'BUY' | 'SELL'
): StrategySimulationSide | null {
  const profile = findStrategySimulationProfile(strategyDisplayName);
  if (!profile) return null;
  return direction === 'BUY' ? profile.buy : profile.sell;
}

/** Preenche campos BUY/SELL da UI a partir do perfil de uma estratégia. */
export function simulationFieldsFromProfile(profile: StrategySimulationProfile): {
  buyStopLoss: string;
  buyTakeProfit1: string;
  buyTakeProfit2: string;
  buyTp1PositionPercent: string;
  buyTp2PositionPercent: string;
  sellStopLoss: string;
  sellTakeProfit1: string;
  sellTakeProfit2: string;
  sellTp1PositionPercent: string;
  sellTp2PositionPercent: string;
  finalCloseHours: string;
} {
  const b = profile.buy;
  const s = profile.sell;
  const hours = b?.finalCloseHours ?? s?.finalCloseHours ?? H24;
  return {
    buyStopLoss: b ? String(b.stopLossPct) : '0',
    buyTakeProfit1: b ? String(b.tp1Pct) : '0',
    buyTakeProfit2: b ? String(b.tp2Pct) : '0',
    buyTp1PositionPercent: b ? String(b.tp1PositionPct) : '0',
    buyTp2PositionPercent: b ? String(b.tp2PositionPct) : '0',
    sellStopLoss: s ? String(s.stopLossPct) : '0',
    sellTakeProfit1: s ? String(s.tp1Pct) : '0',
    sellTakeProfit2: s ? String(s.tp2Pct) : '0',
    sellTp1PositionPercent: s ? String(s.tp1PositionPct) : '0',
    sellTp2PositionPercent: s ? String(s.tp2PositionPct) : '0',
    finalCloseHours: String(hours),
  };
}
