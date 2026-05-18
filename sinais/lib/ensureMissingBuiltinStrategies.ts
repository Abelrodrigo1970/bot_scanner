import type { PrismaClient } from '@prisma/client';
import {
  MACD_HISTOGRAM_PMO_DESCRIPTION,
  MACD_HISTOGRAM_PMO_PARAMS,
  AFASTAMENTO_MEDIO_DESCRIPTION,
  RSI_OVERBOUGHT_DROP_1H_DESCRIPTION,
  RSI_OVERBOUGHT_DROP_1H_PARAMS,
  syncAfastamentoMedio1hScanner3Description,
  syncMacdHistogramPmoParams,
  syncRsiOverboughtDrop1hConfig,
} from './strategyMigrations';

/** Estratégias importadas (foto + afastamento 80/7) — criadas se faltarem na BD. */
export const IMPORTED_BUILTIN_STRATEGY_SEEDS = [
  {
    name: 'MACD_HISTOGRAM_PMO',
    displayName: 'MACD Histogram 1h + PMO',
    description: MACD_HISTOGRAM_PMO_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(MACD_HISTOGRAM_PMO_PARAMS),
  },
  {
    name: 'AFASTAMENTO_MEDIO',
    displayName: 'Afastamento médio (80/7)',
    description: AFASTAMENTO_MEDIO_DESCRIPTION,
    isActive: true,
    params: JSON.stringify({
      maPeriod: 80,
      smoothPeriod: 7,
      meanLineType: 'EMA',
      trendMaType: 'EMA',
      upperThresholdPct: 60,
      lowerThresholdPct: -60,
      buyTrendMaPeriod: 30,
      buySmoothPrevMax: 2,
      buySmoothCurrMin: 3,
      requireSmoothCross: false,
      allowBuy: true,
      allowSell: true,
    }),
  },
  {
    name: 'AFASTAMENTO_MEDIO_30M',
    displayName: 'Afastamento médio 30m (1→2)',
    description:
      'Universo: último scan Scanner 3 (±4% SMA80 em 1h). EMA80 + SMA(7) em 30m. COMPRA: acima EMA80, linha 1→2, preço > EMA30. VENDA: abaixo EMA80 e EMA30, linha 2→2,5. SL 6%; TP 18%.',
    isActive: true,
    params: JSON.stringify({
      maPeriod: 80,
      smoothPeriod: 7,
      meanLineType: 'EMA',
      trendMaType: 'EMA',
      buyTrendMaPeriod: 30,
      buySmoothPrevMax: 1,
      buySmoothCurrMin: 2,
      sellSmoothPrevMax: 2,
      sellSmoothCurrMin: 2.5,
      stopLossPct: 0.06,
      takeProfitPct: 0.18,
      allowBuy: true,
      allowSell: true,
      buyEnabled: true,
      sellEnabled: true,
    }),
  },
  {
    name: 'RSI_OVERBOUGHT_DROP_1H',
    displayName: 'RSI queda de 70 (mín. 4 pts) + afastamento >12% (1h)',
    description: RSI_OVERBOUGHT_DROP_1H_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(RSI_OVERBOUGHT_DROP_1H_PARAMS),
  },
] as const;

export async function ensureMissingBuiltinStrategies(prisma: PrismaClient): Promise<void> {
  for (const def of IMPORTED_BUILTIN_STRATEGY_SEEDS) {
    const existing = await prisma.strategy.findUnique({ where: { name: def.name } });
    if (!existing) {
      await prisma.strategy.create({ data: def });
      console.log(`✅ Estratégia criada: ${def.name}`);
    }
  }
  const macdSync = await syncMacdHistogramPmoParams(prisma);
  if (macdSync.updated) {
    console.log('✅ MACD_HISTOGRAM_PMO: params actualizados (filtros mais selectivos)');
  }
  const rsiSync = await syncRsiOverboughtDrop1hConfig(prisma);
  if (rsiSync.updated) {
    console.log('✅ RSI_OVERBOUGHT_DROP_1H: params/descrição actualizados (SL 8%, TP1/TP2 %)');
  }
  const af1hSync = await syncAfastamentoMedio1hScanner3Description(prisma);
  if (af1hSync.updated) {
    console.log('✅ AFASTAMENTO_MEDIO: descrição actualizada (universo Scanner 3)');
  }
}
