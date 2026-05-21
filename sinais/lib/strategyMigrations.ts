import type { PrismaClient } from '@prisma/client';

/** Estratégias retiradas (não recriar no seed / apagar da BD em produção). */
export const REMOVED_DEPRECATED_STRATEGY_NAMES = [
  'VOLUME_SPIKE',
  'RSI',
  'RSI_15M',
  'RSI_BYBIT_15M',
  'MA_CROSS_15M',
] as const;

export interface RemoveDeprecatedStrategiesResult {
  removed: string[];
  signalsDeleted: number;
}

/**
 * Remove estratégias descontinuadas. Sinais associados são apagados (onDelete: Cascade).
 * Idempotente.
 */
export async function removeDeprecatedStrategies(
  prisma: PrismaClient
): Promise<RemoveDeprecatedStrategiesResult> {
  const removed: string[] = [];
  let signalsDeleted = 0;

  for (const name of REMOVED_DEPRECATED_STRATEGY_NAMES) {
    const row = await prisma.strategy.findUnique({
      where: { name },
      select: { id: true },
    });
    if (!row) continue;

    const signalCount = await prisma.signal.count({
      where: { strategyId: row.id },
    });
    await prisma.strategy.delete({ where: { id: row.id } });
    removed.push(name);
    signalsDeleted += signalCount;
  }

  if (removed.length > 0) {
    console.log(
      `🗑️ Estratégias removidas: ${removed.join(', ')} (${signalsDeleted} sinal(is) em cascade)`
    );
  }

  return { removed, signalsDeleted };
}

export const MA_CROSS_5M_PARAMS = {
  ma30Period: 12,
  ma200Period: 30,
  maType: 'EMA' as const,
  entryDiffPct: 0.9,
  exitDiffPct: 0.5,
  stopPercent: 15,
  sellBlockAbsCloseDistanceFromMa200Pct: 6,
  /** Se true: re-entradas quando spread > limiar e alinhado, desde que haja novo impulso (cruzamento de limiar, mudança de alinhamento ou alargamento mínimo do spread vs vela anterior). */
  ma12x30RepeatWhileTrend: true,
  /** No modo repetir tendência: mínimo (em pts %) que o spread |MA12−MA30|/MA30 deve aumentar vs a vela anterior para contar como «novidade». */
  ma12x30RepeatMinSpreadDeltaPct: 0.06,
  /** TP parcial quando preço vs entrada atinge +N% (compra) ou −N% (venda). */
  ma12x30GainTpPct: 44,
  /** % da posição a fechar nesse TP. */
  ma12x30GainTpPositionPct: 60,
  allowBuy: true,
  allowSell: true,
  exchange: 'binance',
} as const;

export const MA_CROSS_5M_DISPLAY = 'MA Cross 15m (MA12/MA30)';
export const MA_CROSS_5M_DESC =
  'MA12/MA30 em 15m: entrada por spread (|MA12−MA30|/MA30 > 0,9% na direção). Em modo repetir tendência, exige novo impulso (cruzamento do limiar, mudança de alinhamento ou alargamento mínimo do spread vs vela anterior). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada (compra +44%; venda −44%). Restante: fecho dinâmico quando spread < 0,5%. SL 15% (histórico sintético estudado). Filtro SELL se |preço−MA30|/MA30 > 6%. Universo = Scanner 1 (fecho 0–10% acima SMA200 em 1h, Binance Futures). Máx. um trade aberto por símbolo no cron (não empilha o mesmo sentido).';

export const MA_CROSS_1H_DESC =
  'MA12/MA30 em 1h: entrada por spread (>1,2%). Só entra se |MA30−MA200|/MA200 ≤ 8% (MA200 período 200 em 1h). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro BUY e SELL: só se |preço−MA30|/MA30 ≤ 8%. Universo = Scanner 1 (fecho 0–10% acima SMA200 em 1h).';

/** MA30/MA200 em 15m — mesma lógica de spread que MA12/MA30 (universo = scan Ma30Near6PriceBetween). */
export const MA_CROSS_15M_STRATEGY_DESCRIPTION =
  'MA30 / MA200 em 15m: mesma lógica que MA12/MA30 (spread |rápida−lenta|/lenta). Entrada quando o spread ultrapassa o limiar na direção; modo repetir tendência com Δ mínimo opcional; TP parcial quando o preço favorece N% vs entrada; restante fecha quando o spread comprime abaixo do limiar de saída. SL 5%. Filtro SELL por distância do preço à MA200. Universo = scan MA30 entre −6% e +1% vs MA200 (1h) — menu Ma30Near6PriceBetween; actualiza esse scan antes de gerar sinais.';

/** Texto canónico da descrição (universo = tabela Ma30Near6PriceBetween / scan MA30 −6%…+1% vs MA200). */
export const RSI_MA30_SCAN_UNIVERSE_DESCRIPTION =
  'Universo = scan MA30 entre −6% e +1% vs MA200 (1h) — só lista de símbolos. RSI(14) + SMA(21) sobre o RSI (linha lenta). BUY: lenta cruza para cima do 47 → SL -5% | TP1 +43% (50%) | restante às 24h. SELL: lenta passa para baixo do 47 → SL +5% | TP1 -43% (50%) | restante às 24h.';

/** Descrição canónica RSI_15M (universo = mesmo scan Ma30Near6PriceBetween). */
export const RSI_15M_STRATEGY_DESCRIPTION =
  'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo = scan MA30 entre −6% e +1% vs MA200 (1h).';

/** Universo = tabela MaCrossBelow (menu MA Cross Proximidade): MA30 entre −3% e +3% vs MA200 em 1h. */
export const MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION =
  'Universo = scan MA Cross Proximidade (MaCrossBelow): MA30 entre −3% e +3% vs MA200 (1h). COMPRA: fecha 2%+ acima MA60 → SL -15% | TP1 +30% (40%) | TP2 +60% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +15% | TP1 -30% (40%) | TP2 -60% (30%) | 30% na reversão.';

export const MACD_HISTOGRAM_PMO_PARAMS = {
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
  rocPeriodPmo: 35,
  emaFastPmo: 20,
  pmoBuyThreshold: 0,
  pmoSellThreshold: 0,
  symbolLimit: 50,
  minHistogramAbs: 0,
  requireMacdLineConfirm: true,
  requirePmoMomentum: true,
  useClosedCandleOnly: true,
  signalCooldownHours: 4,
  allowBuy: true,
  allowSell: true,
} as const;

export const MACD_HISTOGRAM_PMO_DESCRIPTION =
  'MACD histograma (1h, vela fechada) + PMO. COMPRA: histograma cruza para cima, linha MACD > signal, PMO > 0 e a subir. VENDA: histograma cruza para baixo, MACD < signal, PMO < 0 e a descer. Top 50 movers 1h; cooldown 4 h por símbolo/direcção.';

export const RSI_OVERBOUGHT_DROP_1H_PARAMS = {
  rsiPeriod: 14,
  overboughtLevel: 70,
  minDropPoints: 4,
  minDistancePct: 12,
  maPeriod: 80,
  meanLineType: 'EMA',
  stopLossPct: 0.08,
  sellTp1Percent: 9,
  sellTp2Percent: 19,
  sellTp1Position: 30,
  sellTp2Position: 40,
  allowBuy: false,
  allowSell: true,
} as const;

export const RSI_OVERBOUGHT_DROP_1H_DESCRIPTION =
  'Universo: Scanner 2 (±10% EMA80, 1h). VENDA: RSI cai de ≥70 (≥4 pts) e afastamento à EMA80 >12%. SL +8%. TP1 -9% (30% pos.) | TP2 -19% (40% pos.) | restante fecho manual.';

export const AFASTAMENTO_MEDIO_DISPLAY = 'Afastamento médio 1h (≤2→≥2)';

export const AFASTAMENTO_MEDIO_DESCRIPTION =
  'Universo: Scanner 3 (±4% MA80 em 1h). EMA80 + SMA(7) em 1h. COMPRA: linha ≤2%→≥2%, preço > EMA80 e > EMA30 (SL -4%, TP1 +9% (40%) | restante às 24h). VENDA: linha ≥2%→≤2%, preço < EMA80 e < EMA30 (SL +4%, TP1 -9% (40%) | restante às 24h).';

/** SL/TP 1h: TP parcial + restante ao fecho 24h. */
export const AFASTAMENTO_MEDIO_EXIT_PARAMS = {
  stopLossPct: 0.04,
  tp1Pct: 0.09,
  tp1Position: 40,
  closeAfterHours: 24,
} as const;

/** COMPRA 1h/30m: smooth anterior ≤2% e actual ≥2%. */
export const AFASTAMENTO_MEDIO_BUY_PARAMS = {
  buySmoothPrevMax: 2,
  buySmoothCurrMin: 2,
} as const;

/** VENDA 1h/30m: espelho da compra — smooth anterior ≥2% e actual ≤2%. */
export const AFASTAMENTO_MEDIO_SELL_PARAMS = {
  sellSmoothPrevMin: 2,
  sellSmoothCurrMax: 2,
} as const;

export const AFASTAMENTO_MEDIO_30M_DISPLAY = 'Afastamento médio 30m (≤2↔≥2)';

/** SL/TP 30m: TP parcial + restante ao fecho 24h. */
export const AFASTAMENTO_MEDIO_30M_EXIT_PARAMS = {
  stopLossPct: 0.06,
  tp1Pct: 0.09,
  tp1Position: 50,
  closeAfterHours: 24,
} as const;

export const AFASTAMENTO_MEDIO_30M_DESCRIPTION =
  'Universo: Scanner 3 (±4% MA80 em 1h). EMA80 + SMA(7) em 30m. COMPRA: linha ≤2%→≥2%, preço > EMA80 e > EMA30 (SL -6%, TP1 +9% (50%) | restante às 24h). VENDA: linha ≥2%→≤2%, preço < EMA80 e < EMA30 (SL +6%, TP1 -9% (50%) | restante às 24h).';

/** @deprecated Use AFASTAMENTO_MEDIO_BUY_PARAMS */
export const AFASTAMENTO_MEDIO_30M_BUY_PARAMS = AFASTAMENTO_MEDIO_BUY_PARAMS;

/** Actualiza COMPRA ≤2→≥2 em AFASTAMENTO_MEDIO (1h). */
export async function syncAfastamentoMedio1hBuyThresholds(
  prisma: PrismaClient
): Promise<{ updated: boolean }> {
  const row = await prisma.strategy.findUnique({
    where: { name: 'AFASTAMENTO_MEDIO' },
    select: { params: true, displayName: true, description: true },
  });
  if (!row) return { updated: false };

  let p: Record<string, unknown> = {};
  try {
    p = row.params ? JSON.parse(row.params) : {};
  } catch {
    p = {};
  }

  const currMin = Number(p.buySmoothCurrMin);
  const prevMax = Number(p.buySmoothPrevMax);
  const needsBuy =
    p.buySmoothCurrMin == null ||
    currMin === 3 ||
    currMin > 2 ||
    p.buySmoothPrevMax == null ||
    prevMax === 1 ||
    prevMax < 2;
  const needsSell =
    p.sellSmoothPrevMin == null ||
    p.sellSmoothCurrMax == null ||
    p.sellSmoothCurrMin != null ||
    p.sellSmoothPrevMax != null ||
    Number(p.sellSmoothCurrMin) === 2.5;
  const needsMeta =
    row.displayName?.includes('(80/7)') ||
    row.description?.includes('≥3') ||
    row.description?.includes('para ≥3') ||
    row.description?.includes('>60%') ||
    row.description?.includes('TP +20%') ||
    row.description?.includes('TP -20%') ||
    row.description !== AFASTAMENTO_MEDIO_DESCRIPTION;
  const needsExit =
    Number(p.stopLossPct ?? 0) !== AFASTAMENTO_MEDIO_EXIT_PARAMS.stopLossPct ||
    Number(p.tp1Pct ?? 0) !== AFASTAMENTO_MEDIO_EXIT_PARAMS.tp1Pct ||
    Number(p.tp1Position ?? 0) !== AFASTAMENTO_MEDIO_EXIT_PARAMS.tp1Position ||
    Number(p.closeAfterHours ?? 0) !== AFASTAMENTO_MEDIO_EXIT_PARAMS.closeAfterHours;

  if (!needsBuy && !needsSell && !needsMeta && !needsExit) return { updated: false };

  const next: Record<string, unknown> = {
    ...p,
    ...(needsBuy ? AFASTAMENTO_MEDIO_BUY_PARAMS : {}),
    ...(needsSell ? AFASTAMENTO_MEDIO_SELL_PARAMS : {}),
    ...(needsExit || needsMeta ? AFASTAMENTO_MEDIO_EXIT_PARAMS : {}),
  };
  if (needsSell) {
    delete next.sellSmoothPrevMax;
    delete next.sellSmoothCurrMin;
  }

  await prisma.strategy.update({
    where: { name: 'AFASTAMENTO_MEDIO' },
    data: {
      params: JSON.stringify(next),
      displayName: AFASTAMENTO_MEDIO_DISPLAY,
      description: AFASTAMENTO_MEDIO_DESCRIPTION,
    },
  });
  return { updated: true };
}

/** Actualiza buySmoothPrevMax 1→2 em AFASTAMENTO_MEDIO_30M (deploy / cron). */
export async function syncAfastamentoMedio30mBuyPrevMax(
  prisma: PrismaClient
): Promise<{ updated: boolean }> {
  const row = await prisma.strategy.findUnique({
    where: { name: 'AFASTAMENTO_MEDIO_30M' },
    select: { params: true, displayName: true, description: true },
  });
  if (!row) return { updated: false };

  let p: Record<string, unknown> = {};
  try {
    p = row.params ? JSON.parse(row.params) : {};
  } catch {
    p = {};
  }

  const prevMax = Number(p.buySmoothPrevMax);
  const needsBuyPrev =
    p.buySmoothPrevMax == null || prevMax === 1 || prevMax < 2;
  const needsSell =
    p.sellSmoothPrevMin == null ||
    p.sellSmoothCurrMax == null ||
    p.sellSmoothCurrMin != null ||
    Number(p.sellSmoothCurrMin) === 2.5;
  const needsMeta =
    row.displayName?.includes('1→2') ||
    row.description?.includes('linha 1→2') ||
    row.description?.includes('2→2,5') ||
    row.description?.includes('TP 18%') ||
    row.description !== AFASTAMENTO_MEDIO_30M_DESCRIPTION;
  const needsExit =
    Number(p.stopLossPct ?? 0) !== AFASTAMENTO_MEDIO_30M_EXIT_PARAMS.stopLossPct ||
    Number(p.tp1Pct ?? 0) !== AFASTAMENTO_MEDIO_30M_EXIT_PARAMS.tp1Pct ||
    Number(p.tp1Position ?? 0) !== AFASTAMENTO_MEDIO_30M_EXIT_PARAMS.tp1Position ||
    Number(p.closeAfterHours ?? 0) !== AFASTAMENTO_MEDIO_30M_EXIT_PARAMS.closeAfterHours ||
    p.takeProfitPct != null;

  if (!needsBuyPrev && !needsSell && !needsMeta && !needsExit) return { updated: false };

  const next: Record<string, unknown> = {
    ...p,
    ...(needsBuyPrev ? AFASTAMENTO_MEDIO_BUY_PARAMS : {}),
    ...(needsSell ? AFASTAMENTO_MEDIO_SELL_PARAMS : {}),
    ...(needsExit || needsMeta ? AFASTAMENTO_MEDIO_30M_EXIT_PARAMS : {}),
  };
  if (needsExit) {
    delete next.takeProfitPct;
  }
  if (needsSell) {
    delete next.sellSmoothPrevMax;
    delete next.sellSmoothCurrMin;
  }

  await prisma.strategy.update({
    where: { name: 'AFASTAMENTO_MEDIO_30M' },
    data: {
      params: JSON.stringify(next),
      displayName: AFASTAMENTO_MEDIO_30M_DISPLAY,
      description: AFASTAMENTO_MEDIO_30M_DESCRIPTION,
    },
  });
  return { updated: true };
}

/** Actualiza descrição AFASTAMENTO_MEDIO se ainda referir Scanner 1. */
export async function syncAfastamentoMedio1hScanner3Description(
  prisma: PrismaClient
): Promise<{ updated: boolean }> {
  const row = await prisma.strategy.findUnique({
    where: { name: 'AFASTAMENTO_MEDIO' },
    select: { description: true },
  });
  if (!row) return { updated: false };
  if (
    !row.description?.includes('Scanner 1') &&
    !row.description?.includes('SMA200') &&
    row.description === AFASTAMENTO_MEDIO_DESCRIPTION
  ) {
    return { updated: false };
  }
  await prisma.strategy.update({
    where: { name: 'AFASTAMENTO_MEDIO' },
    data: { description: AFASTAMENTO_MEDIO_DESCRIPTION },
  });
  return { updated: true };
}

/** Actualiza descrição e params RSI (Scanner 2 EMA80, SL/TP %). */
export async function syncRsiOverboughtDrop1hConfig(
  prisma: PrismaClient
): Promise<{ updated: boolean }> {
  const row = await prisma.strategy.findUnique({
    where: { name: 'RSI_OVERBOUGHT_DROP_1H' },
    select: { params: true, description: true },
  });
  if (!row) return { updated: false };

  let p: Record<string, unknown> = {};
  try {
    p = row.params ? JSON.parse(row.params) : {};
  } catch {
    p = {};
  }

  const needsSlTp =
    p.stopLossPct === 0.06 ||
    p.stopLossPct === '0.06' ||
    p.sellTp1Percent == null ||
    p.sellTp2Percent == null;
  const needsDesc =
    row.description?.includes('SMA80') ||
    row.description?.includes('TP na EMA80') ||
    row.description?.includes('SL 6%') ||
    row.description !== RSI_OVERBOUGHT_DROP_1H_DESCRIPTION;

  if (!needsSlTp && !needsDesc) return { updated: false };

  const next = {
    ...RSI_OVERBOUGHT_DROP_1H_PARAMS,
    ...p,
    ...(needsSlTp
      ? {
          stopLossPct: 0.08,
          sellTp1Percent: 9,
          sellTp2Percent: 19,
          sellTp1Position: 30,
          sellTp2Position: 40,
        }
      : {}),
  };

  await prisma.strategy.update({
    where: { name: 'RSI_OVERBOUGHT_DROP_1H' },
    data: {
      params: JSON.stringify(next),
      description: RSI_OVERBOUGHT_DROP_1H_DESCRIPTION,
    },
  });
  return { updated: true };
}

/** @deprecated Use syncRsiOverboughtDrop1hConfig */
export async function syncRsiScanner2EmaDescription(
  prisma: PrismaClient
): Promise<{ updated: boolean }> {
  return syncRsiOverboughtDrop1hConfig(prisma);
}

/**
 * Aperta params legados (PMO ±0,5, 150 símbolos) para filtros mais selectivos.
 * Idempotente; não sobrescreve thresholds personalizados.
 */
export async function syncMacdHistogramPmoParams(
  prisma: PrismaClient
): Promise<{ updated: boolean }> {
  const row = await prisma.strategy.findUnique({
    where: { name: 'MACD_HISTOGRAM_PMO' },
    select: { params: true, description: true },
  });
  if (!row) return { updated: false };

  let p: Record<string, unknown> = {};
  try {
    p = row.params ? JSON.parse(row.params) : {};
  } catch {
    p = {};
  }

  const hasLoosePmo =
    p.pmoBuyThreshold === -0.5 ||
    p.pmoBuyThreshold === '-0.5' ||
    (p.pmoBuyThreshold == null && p.pmoSellThreshold == null);
  const hasLooseSellPmo = p.pmoSellThreshold === 0.5 || p.pmoSellThreshold === '0.5';
  const missingGuards =
    p.useClosedCandleOnly == null ||
    p.requireMacdLineConfirm == null ||
    p.requirePmoMomentum == null;
  const wideUniverse =
    p.symbolLimit == null || Number(p.symbolLimit) >= 150;

  if (!hasLoosePmo && !hasLooseSellPmo && !missingGuards && !wideUniverse) {
    if (row.description === MACD_HISTOGRAM_PMO_DESCRIPTION) {
      return { updated: false };
    }
    await prisma.strategy.update({
      where: { name: 'MACD_HISTOGRAM_PMO' },
      data: { description: MACD_HISTOGRAM_PMO_DESCRIPTION },
    });
    return { updated: true };
  }

  const next = {
    ...MACD_HISTOGRAM_PMO_PARAMS,
    ...p,
    ...(hasLoosePmo || hasLooseSellPmo
      ? { pmoBuyThreshold: 0, pmoSellThreshold: 0 }
      : {}),
    ...(missingGuards
      ? {
          useClosedCandleOnly: true,
          requireMacdLineConfirm: true,
          requirePmoMomentum: true,
        }
      : {}),
    ...(wideUniverse ? { symbolLimit: 50, signalCooldownHours: 4 } : {}),
  };

  await prisma.strategy.update({
    where: { name: 'MACD_HISTOGRAM_PMO' },
    data: {
      params: JSON.stringify(next),
      description: MACD_HISTOGRAM_PMO_DESCRIPTION,
    },
  });
  return { updated: true };
}

/**
 * Actualiza descrições MA Cross se ainda referirem universo Bybit (legado).
 */
export async function syncMaCrossScanner1UniverseDescriptions(
  prisma: PrismaClient
): Promise<{ updated: string[] }> {
  const updated: string[] = [];

  for (const [name, description] of [
    ['MA_CROSS_5M', MA_CROSS_5M_DESC] as const,
    ['MA_CROSS_1H', MA_CROSS_1H_DESC] as const,
  ]) {
    const row = await prisma.strategy.findUnique({
      where: { name },
      select: { description: true },
    });
    if (!row) continue;
    const needsUpdate =
      row.description?.includes('Bybit') ||
      row.description?.includes('bybit') ||
      row.description !== description;
    if (needsUpdate) {
      await prisma.strategy.update({
        where: { name },
        data: { description },
      });
      updated.push(name);
    }
  }

  return { updated };
}

/**
 * Actualiza descrições em BD se ainda mencionarem Top Voláteis como universo (legado).
 * Idempotente; chamado em GET /api/strategies.
 */
export async function syncRsiMaVolatileUniverseDescriptions(
  prisma: PrismaClient
): Promise<{ updated: string[] }> {
  const updated: string[] = [];

  const maV = await prisma.strategy.findUnique({
    where: { name: 'MA_VOLATILE' },
    select: { description: true },
  });
  const maVNeedsLegacyTopVolatile = maV?.description?.includes('Top Voláteis');
  const maVNeedsMa30ScanUniverse =
    maV?.description?.includes('COMPRA: fecha 2%+') &&
    maV?.description?.includes('scan MA30 < -5% vs MA200');
  if (maV && (maVNeedsLegacyTopVolatile || maVNeedsMa30ScanUniverse)) {
    await prisma.strategy.update({
      where: { name: 'MA_VOLATILE' },
      data: { description: MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION },
    });
    updated.push('MA_VOLATILE');
  }

  return { updated };
}

export interface MigrateVolumeSpike15mResult {
  action: 'none' | 'renamed' | 'merged' | 'already_ok';
  message: string;
  signalsReassigned?: number;
  /** Sinais com `strategyName` legado corrigido para o display MA Cross 5m */
  signalsRelabeled?: number;
}

/**
 * Alinha `Signal.strategyName` com o display actual de MA_CROSS_5M (dashboard / resultados usam este campo).
 * Cobre: "Volume Spike 15m", textos MA30/MA200 ou MA30/MA60 antigos, ou qualquer outro display desactualizado.
 */
export async function backfillMaCross5mSignalNames(prisma: PrismaClient): Promise<number> {
  const mc = await prisma.strategy.findFirst({ where: { name: 'MA_CROSS_5M' } });
  if (!mc) return 0;
  const n = await prisma.signal.updateMany({
    where: {
      strategyId: mc.id,
      strategyName: { not: MA_CROSS_5M_DISPLAY },
    },
    data: { strategyName: MA_CROSS_5M_DISPLAY },
  });
  return n.count;
}

/**
 * Bases antigas: linha VOLUME_SPIKE_15M → MA_CROSS_5M (funde ou renomeia).
 * Idempotente: pode correr várias vezes.
 */
export async function migrateVolumeSpike15mToMaCross5m(
  prisma: PrismaClient
): Promise<MigrateVolumeSpike15mResult> {
  const legacy = await prisma.strategy.findFirst({ where: { name: 'VOLUME_SPIKE_15M' } });
  const modern = await prisma.strategy.findFirst({ where: { name: 'MA_CROSS_5M' } });

  if (!legacy) {
    if (modern) {
      const relabeled = await backfillMaCross5mSignalNames(prisma);
      return {
        action: 'already_ok',
        message: 'Não existe VOLUME_SPIKE_15M; MA_CROSS_5M presente.',
        signalsRelabeled: relabeled,
      };
    }
    return { action: 'none', message: 'Nem legado nem MA_CROSS_5M — correr seed para criar MA_CROSS_5M.' };
  }

  if (legacy && modern) {
    const n = await prisma.signal.updateMany({
      where: { strategyId: legacy.id },
      data: { strategyId: modern.id, strategyName: MA_CROSS_5M_DISPLAY },
    });
    await prisma.strategy.delete({ where: { id: legacy.id } });
    const relabeled = await backfillMaCross5mSignalNames(prisma);
    return {
      action: 'merged',
      message: 'VOLUME_SPIKE_15M removida; sinais reatribuídos a MA_CROSS_5M.',
      signalsReassigned: n.count,
      signalsRelabeled: relabeled,
    };
  }

  await prisma.strategy.update({
    where: { id: legacy.id },
    data: {
      name: 'MA_CROSS_5M',
      displayName: MA_CROSS_5M_DISPLAY,
      description: MA_CROSS_5M_DESC,
      isActive: true,
      params: JSON.stringify(MA_CROSS_5M_PARAMS),
    },
  });
  const renamedSignals = await prisma.signal.updateMany({
    where: { strategyId: legacy.id },
    data: { strategyName: MA_CROSS_5M_DISPLAY },
  });
  return {
    action: 'renamed',
    message: 'Registo VOLUME_SPIKE_15M renomeado in-place para MA_CROSS_5M.',
    signalsRelabeled: renamedSignals.count,
  };
}
