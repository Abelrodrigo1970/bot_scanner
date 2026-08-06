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
    strategyName: 'PIVOT_BOSS_BEAR_15M',
    displayNames: ['Pivot Boss Bear 15m (4 EMA venda)'],
    buy: null,
    sell: side(7, 9, 50),
    summary:
      'Só VENDA. Stack 12/30/80/200 bearish. SL +7% fixo. TP1 -9% (50%) | restante às 24h.',
  },
  {
    strategyName: 'SCANNER1_TOP5',
    displayNames: ['Scanner 2 Top 4 (rotação 4h)'],
    buy: side(1, 0, 0, 0, 0, 24),
    sell: side(1, 0, 0, 0, 0, 24),
    summary: 'LONG top 4 (SL 1%) + SHORT saídas (SL 1%). Sem TP. Fecho SHORT 24h.',
  },
  {
    strategyName: 'SCANNER2_SHORT_LEADER_24H',
    displayNames: ['Scanner 2 Short Leader 24h'],
    buy: null,
    sell: side(25, 0, 0, 0, 0, 24),
    summary: 'SHORT rank #2 Scanner 2. Pump 50–90%. SL +25%. Fecho 24h. Bloqueio 10–14h PT.',
  },
  {
    strategyName: 'SCANNER2_STOCH_RSI_5M',
    displayNames: ['Scanner 2 Stoch RSI Top 4 (5m)'],
    buy: side(5, 0, 0, 0, 0, 0),
    sell: side(7, 0, 0, 0, 0, 0),
    summary:
      'Top 4 Scanner 2. Stoch RSI 5m (50/50/40/11). LONG se K×D up (SL -5%). Após fecho LONG, SHORT se preço ≤ MA21−1% (SL +7%). Sem TP.',
  },
  {
    strategyName: 'SCANNER3_RSI_FLIP_1H',
    displayNames: ['Scanner 3 RSI Flip 15m', 'Scanner 3 RSI Flip 1h'],
    buy: side(5, 0, 0, 0, 0, 72),
    sell: side(5, 0, 0, 0, 0, 24),
    summary:
      'Scan 1h RSI>75 ranks 6–14. LONG 15m se RSI 15m≥70 (SL -5%, 72h). SHORT quando RSI 15m cruza <70 (SL +5%, 24h). Sem TP.',
  },
  {
    strategyName: 'SCANNER3_RSI_BREAKOUT_15M',
    displayNames: ['Scanner 3 RSI Rompimento 1h', 'Scanner 3 RSI Rompimento 15m'],
    buy: side(7, 10.5, 50),
    sell: null,
    summary: 'Só COMPRA. Velas 1h. SL -7%. TP1 R×1,5 (~10,5%, 50% pos.). Restante às 24h.',
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
