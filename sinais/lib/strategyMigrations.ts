import type { PrismaClient } from '@prisma/client';

export const MA_CROSS_5M_PARAMS = {
  ma30Period: 12,
  ma200Period: 30,
  maType: 'EMA' as const,
  confirmationPct: 0,
  stopPercent: 4,
  sellBlockAbsCloseDistanceFromMa200Pct: 6,
  buyTp1Percent: 18,
  buyTp1Position: 30,
  buyTp2Percent: 40,
  buyTp2Position: 30,
  sellTp1Percent: 7,
  sellTp1Position: 30,
  sellTp2Percent: 15,
  sellTp2Position: 30,
  allowBuy: true,
  allowSell: true,
  exchange: 'binance',
} as const;

export const MA_CROSS_5M_DISPLAY = 'MA Cross 15m (MA12/MA30)';
export const MA_CROSS_5M_DESC =
  'Golden / Death Cross em 15m: MA12 cruza MA30. Universo = scan MA30>9% MA200 (1h) no menu. SL 4%. BUY: TP1 +18% (30%) | TP2 +40% (30%). SELL: TP1 -7% (30%) | TP2 -15% (30%). Reversão: fecha posição oposta e abre nova no sinal contrário. Atualizar scan; cron 15m.';

/** Texto canónico da descrição (universo = tabela Ma30Near6PriceBetween / scan MA30 < -5%). */
export const RSI_MA30_SCAN_UNIVERSE_DESCRIPTION =
  'Universo = scan MA30 < -5% vs MA200 (1h). BUY quando RSI cruza acima de 60 E preço > MA200 → SL -3% | sem TP intermédio | 100% às 24h. SELL quando RSI cruza abaixo de 40 E preço < MA200 → SL +3% | sem TP intermédio | 100% às 24h.';

export const MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION =
  'Universo = scan MA30 < -5% vs MA200 (1h). COMPRA: fecha 2%+ acima MA60 → SL -15% | TP1 +30% (40%) | TP2 +60% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +15% | TP1 -30% (40%) | TP2 -60% (30%) | 30% na reversão.';

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
  if (rsi?.description?.includes('Top Voláteis')) {
    await prisma.strategy.update({
      where: { name: 'RSI' },
      data: { description: RSI_MA30_SCAN_UNIVERSE_DESCRIPTION },
    });
    updated.push('RSI');
  }

  const maV = await prisma.strategy.findUnique({
    where: { name: 'MA_VOLATILE' },
    select: { description: true },
  });
  if (maV?.description?.includes('Top Voláteis')) {
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
