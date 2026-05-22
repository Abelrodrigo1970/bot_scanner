import type { PrismaClient } from '@prisma/client';
import {
  MACD_HISTOGRAM_PMO_DESCRIPTION,
  MACD_HISTOGRAM_PMO_PARAMS,
  AFASTAMENTO_MEDIO_DESCRIPTION,
  AFASTAMENTO_MEDIO_DISPLAY,
  AFASTAMENTO_MEDIO_BUY_PARAMS,
  AFASTAMENTO_MEDIO_EXIT_PARAMS,
  AFASTAMENTO_MEDIO_SELL_PARAMS,
  AFASTAMENTO_MEDIO_30M_DESCRIPTION,
  AFASTAMENTO_MEDIO_30M_EXIT_PARAMS,
  AFASTAMENTO_MEDIO_30M_DISPLAY,
  AFASTAMENTO_MEDIO_30M_BUY_PARAMS,
  AFASTAMENTO_MEDIO_30M_SELL_PARAMS,
  AFASTAMENTO_STRENGTH_FILTER_PARAMS,
  RSI_OVERBOUGHT_DROP_1H_DESCRIPTION,
  RSI_OVERBOUGHT_DROP_1H_PARAMS,
  PIVOT_BOSS_BEAR_15M_DESCRIPTION,
  PIVOT_BOSS_BEAR_15M_PARAMS,
  PIVOT_BOSS_BEAR_15M_DISPLAY,
  syncAfastamentoMedio1hBuyThresholds,
  syncAfastamentoMedio1hScanner3Description,
  syncAfastamentoMedio30mBuyPrevMax,
  syncMacdHistogramPmoParams,
  syncPivotBossBear15mUniverse,
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
    displayName: AFASTAMENTO_MEDIO_DISPLAY,
    description: AFASTAMENTO_MEDIO_DESCRIPTION,
    isActive: true,
    params: JSON.stringify({
      maPeriod: 80,
      smoothPeriod: 7,
      meanLineType: 'EMA',
      trendMaType: 'EMA',
      buyTrendMaPeriod: 30,
      ...AFASTAMENTO_MEDIO_BUY_PARAMS,
      ...AFASTAMENTO_MEDIO_SELL_PARAMS,
      ...AFASTAMENTO_MEDIO_EXIT_PARAMS,
      ...AFASTAMENTO_STRENGTH_FILTER_PARAMS,
      allowBuy: true,
      allowSell: true,
    }),
  },
  {
    name: 'AFASTAMENTO_MEDIO_30M',
    displayName: AFASTAMENTO_MEDIO_30M_DISPLAY,
    description: AFASTAMENTO_MEDIO_30M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify({
      maPeriod: 80,
      smoothPeriod: 7,
      meanLineType: 'EMA',
      trendMaType: 'EMA',
      buyTrendMaPeriod: 30,
      ...AFASTAMENTO_MEDIO_30M_BUY_PARAMS,
      ...AFASTAMENTO_MEDIO_30M_SELL_PARAMS,
      ...AFASTAMENTO_MEDIO_30M_EXIT_PARAMS,
      ...AFASTAMENTO_STRENGTH_FILTER_PARAMS,
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
  {
    name: 'PIVOT_BOSS_BEAR_15M',
    displayName: PIVOT_BOSS_BEAR_15M_DISPLAY,
    description: PIVOT_BOSS_BEAR_15M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(PIVOT_BOSS_BEAR_15M_PARAMS),
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
  const af1hBuySync = await syncAfastamentoMedio1hBuyThresholds(prisma);
  if (af1hBuySync.updated) {
    console.log('✅ AFASTAMENTO_MEDIO: COMPRA/VENDA ≤1,5↔≥2,5 (1h) + maxStrength 75');
  }
  const af30mSync = await syncAfastamentoMedio30mBuyPrevMax(prisma);
  if (af30mSync.updated) {
    console.log('✅ AFASTAMENTO_MEDIO_30M: COMPRA/VENDA ≤2↔≥2,3 (30m) + maxStrength 75');
  }
  const pivotBossSync = await syncPivotBossBear15mUniverse(prisma);
  if (pivotBossSync.updated) {
    console.log('✅ PIVOT_BOSS_BEAR_15M: universo Scanner 2 (±10% EMA80, 1h)');
  }
}
