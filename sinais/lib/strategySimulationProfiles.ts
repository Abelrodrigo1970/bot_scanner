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

/** SL dinâmico (ATR/swing); valores médios para simulação conservadora. */
const EMA_RIBBON_SELL = side(2.9, 4.8, 55, 9.3, 35);

export const STRATEGY_SIMULATION_PROFILES: StrategySimulationProfile[] = [
  {
    strategyName: 'MA_CROSS_5M',
    displayNames: ['MA Cross 15m (MA12/MA30)', 'Volume Spike 15m'],
    buy: side(15, 44, 60),
    sell: side(15, 44, 60),
    summary:
      'SL 15%. TP1 ±44% (60% pos.). Restante: fecho dinâmico se spread MA12/MA30 < 0,5%.',
  },
  {
    strategyName: 'SCANNER1_TOP8',
    displayNames: ['Scanner 1 Top 6 (excl. ranks 3–4, rotação 4h)', 'Scanner 1 Top 8 (rotação 4h)'],
    buy: side(5, 0, 0, 0, 0, 4),
    sell: null,
    summary: 'SL 5%. Sem TP — rotação total a cada scan (4h). 6 posições (ranks 1,2,5–8; excl. #3 #4).',
  },
  {
    strategyName: 'SCANNER_MA80_TOP6',
    displayNames: ['Scanner 5 Top 6 (excl. ranks 2–3, rotação diária)'],
    buy: side(5, 0, 0, 0, 0, 24),
    sell: null,
    summary: 'SL 5%. Sem TP — rotação total 1×/dia. 6 posições (ranks 1,4–8; excl. #2 #3).',
  },
  {
    strategyName: 'SCANNER_MA80_4H_TOP6',
    displayNames: ['Scanner 6 Top 6 (excl. ranks 3–6, rotação 4h)', 'Scanner 6 Top 6 (excl. ranks 3–4, rotação 4h)'],
    buy: side(7, 0, 0, 0, 0, 4),
    sell: null,
    summary: 'SL 7%. Sem TP — rotação total a cada scan (4h). 6 posições (ranks 1,2,4,5,7–8; excl. #3 #6).',
  },
  {
    strategyName: 'MA200_VOLATILE',
    displayNames: ['MA200 Top Voláteis'],
    buy: side(4, 80, 70),
    sell: side(4, 80, 70),
    summary: 'SL 4%. TP1 ±80% (70% pos.). Restante às 24h.',
  },
  {
    strategyName: 'AFASTAMENTO_MEDIO_30M',
    displayNames: [
      'Afastamento médio 30m (≤2→≥2,3)',
      'Afastamento médio 30m (≤1,5↔≥2,5)',
      'Afastamento médio 30m (≤2↔≥2)',
    ],
    buy: side(6, 9, 50),
    sell: side(6, 9, 50),
    summary: 'SL 6%. TP1 ±9% (50% pos.). Restante às 24h.',
  },
  {
    strategyName: 'RSI_OVERBOUGHT_DROP_1H',
    displayNames: [
      'RSI pullback bear 1h (queda pós-rally EMA30)',
      'RSI queda de 70 (mín. 4 pts) + afastamento >12% (1h)',
    ],
    buy: null,
    sell: side(8, 9, 50, 28, 30),
    summary:
      'Só VENDA. SL +8%. TP1 -9% (50%) | TP2 -28% (30%) | restante fecho manual.',
  },
  {
    strategyName: 'RSI_OVERBOUGHT_DROP_LEGACY_1H',
    displayNames: ['RSI queda de 70 (mín. 4 pts) + afastamento >10% (1h)'],
    buy: null,
    sell: side(8, 9, 50, 28, 30),
    summary:
      'Só VENDA. SL +8%. TP1 -9% (50%) | TP2 -28% (30%) | restante fecho manual.',
  },
  {
    strategyName: 'MACD_HISTOGRAM_PMO',
    displayNames: ['MACD Histogram 1h + PMO'],
    buy: side(4, 20, 100),
    sell: side(4, 20, 100),
    summary: 'SL 4%. TP ±20% (posição total).',
  },
  {
    strategyName: 'EMA_SCALPING',
    displayNames: ['EMA Ribbon Scalping BUY (15m)'],
    buy: EMA_RIBBON_SELL,
    sell: null,
    summary:
      'Só COMPRA. Tendência de alta + retração. SL dinâmico (ATR/swing, máx. ~2,9%). TP1 R×1,65 (~4,8%, 55%) | TP2 R×3,2 (~9,3%, 35%).',
  },
  {
    strategyName: 'EMA_SCALPING_SELL',
    displayNames: ['EMA Ribbon Scalping SELL (15m)'],
    buy: null,
    sell: EMA_RIBBON_SELL,
    summary:
      'Descontinuado. SL dinâmico (ATR/swing, máx. ~2,9%). TP1 R×1,65 (~4,8%, 55%) | TP2 R×3,2 (~9,3%, 35%).',
  },
  {
    strategyName: 'PIVOT_BOSS_BEAR_15M',
    displayNames: ['Pivot Boss Bear 15m (4 EMA venda)'],
    buy: null,
    sell: side(8, 9, 50),
    summary:
      'Só VENDA. Stack 12/30/80/200 bearish. SL +8% fixo. TP1 -9% (50%) | restante às 24h.',
  },
  {
    strategyName: 'PIVOT_BOSS_BEAR_1H',
    displayNames: ['Pivot Boss Bear 1h (4 EMA venda)'],
    buy: null,
    sell: side(8, 9, 50),
    summary:
      'Só VENDA. Stack 12/30/80/200 bearish em 1h. SL +8% fixo. TP1 -9% (50%) | restante às 24h.',
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
