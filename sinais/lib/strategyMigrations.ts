import type { PrismaClient } from '@prisma/client';

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
  'MA12/MA30 em 15m: entrada por spread (|MA12−MA30|/MA30 > 0,9% na direção). Em modo repetir tendência, exige novo impulso (cruzamento do limiar, mudança de alinhamento ou alargamento mínimo do spread vs vela anterior). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada (compra +44%; venda −44%). Restante: fecho dinâmico quando spread < 0,5%. SL 15% (histórico sintético estudado). Filtro SELL se |preço−MA30|/MA30 > 6%. Universo = scan Bybit Volume 1h >500k e MA200 (1h). Máx. um trade aberto por símbolo no cron (não empilha o mesmo sentido).';

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

/**
 * Actualiza descrições em BD se ainda mencionarem Top Voláteis como universo (legado).
 * Idempotente; chamado em GET /api/strategies.
 */
export async function syncRsiMaVolatileUniverseDescriptions(
  prisma: PrismaClient
): Promise<{ updated: string[] }> {
  const updated: string[] = [];

  const rsi = await prisma.strategy.findUnique({
    where: { name: 'RSI' },
    select: { description: true },
  });
  const rsiDesc = rsi?.description ?? '';
  const rsiNeedsRsiDescUpdate =
    rsiDesc.includes('Top Voláteis') ||
    rsiDesc.includes('cruza acima de 60') ||
    rsiDesc.includes('cruza abaixo de 40') ||
    rsiDesc.includes('RSI cruza') ||
    rsiDesc.includes('MA30 < -5%') ||
    rsiDesc.includes('MA30 < −5%') ||
    rsiDesc.includes('entre −9% e −3%') ||
    rsiDesc.includes('entre -9% e -3%');
  if (rsi && rsiNeedsRsiDescUpdate) {
    await prisma.strategy.update({
      where: { name: 'RSI' },
      data: { description: RSI_MA30_SCAN_UNIVERSE_DESCRIPTION },
    });
    updated.push('RSI');
  }

  const rsi15m = await prisma.strategy.findUnique({
    where: { name: 'RSI_15M' },
    select: { description: true },
  });
  const rsi15mDesc = rsi15m?.description ?? '';
  const rsi15mNeedsUniverseText =
    rsi15mDesc.includes('entre −9% e −3%') || rsi15mDesc.includes('entre -9% e -3%');
  if (rsi15m && rsi15mNeedsUniverseText) {
    await prisma.strategy.update({
      where: { name: 'RSI_15M' },
      data: { description: RSI_15M_STRATEGY_DESCRIPTION },
    });
    updated.push('RSI_15M');
  }

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
