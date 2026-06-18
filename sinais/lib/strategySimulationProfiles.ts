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
    strategyName: 'SCANNER_S6_SHORT_LEADER_12H',
    displayNames: ['Scanner 6 Short Leader 12h'],
    buy: null,
    sell: side(7, 0, 0, 0, 0, 12),
    summary: 'SHORT rank #1 Scanner 6. SL +7%. Fecho 12h (slots 0/8/12/20h PT).',
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
