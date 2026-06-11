import type { PrismaClient } from '@prisma/client';
import {
  AFASTAMENTO_MEDIO_30M_DESCRIPTION,
  AFASTAMENTO_MEDIO_30M_EXIT_PARAMS,
  AFASTAMENTO_MEDIO_30M_DISPLAY,
  AFASTAMENTO_MEDIO_30M_BUY_PARAMS,
  AFASTAMENTO_MEDIO_30M_SELL_PARAMS,
  AFASTAMENTO_STRENGTH_FILTER_PARAMS,
  RSI_OVERBOUGHT_DROP_1H_DESCRIPTION,
  RSI_OVERBOUGHT_DROP_1H_DISPLAY,
  RSI_OVERBOUGHT_DROP_1H_PARAMS,
  RSI_OVERBOUGHT_DROP_LEGACY_1H_DESCRIPTION,
  RSI_OVERBOUGHT_DROP_LEGACY_1H_DISPLAY,
  RSI_OVERBOUGHT_DROP_LEGACY_1H_PARAMS,
  PIVOT_BOSS_BEAR_15M_DESCRIPTION,
  PIVOT_BOSS_BEAR_15M_PARAMS,
  PIVOT_BOSS_BEAR_15M_DISPLAY,
  PIVOT_BOSS_BEAR_1H_DESCRIPTION,
  PIVOT_BOSS_BEAR_1H_PARAMS,
  PIVOT_BOSS_BEAR_1H_DISPLAY,
  SCANNER1_TOP8_DESCRIPTION,
  SCANNER1_TOP8_DISPLAY,
  SCANNER1_TOP8_PARAMS,
  SCANNER_MA80_TOP6_DESCRIPTION,
  SCANNER_MA80_TOP6_DISPLAY,
  SCANNER_MA80_TOP6_PARAMS,
  SCANNER_MA80_4H_TOP6_DESCRIPTION,
  SCANNER_MA80_4H_TOP6_DISPLAY,
  SCANNER_MA80_4H_TOP6_PARAMS,
  syncAfastamentoMedio30mBuyPrevMax,
  syncEmaRibbonScalpingBuy15m,
  syncPivotBossBear15mUniverse,
  syncRsiOverboughtDrop1hConfig,
  syncRsiOverboughtDropLegacy1hConfig,
  syncScanner1Top8Config,
  syncScannerMa80Top6Config,
  syncScannerMa804hTop6Config,
} from './strategyMigrations';

/** Estratégias importadas (foto + afastamento 80/7) — criadas se faltarem na BD. */
export const IMPORTED_BUILTIN_STRATEGY_SEEDS = [
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
      exchange: 'bybit',
    }),
  },
  {
    name: 'RSI_OVERBOUGHT_DROP_1H',
    displayName: RSI_OVERBOUGHT_DROP_1H_DISPLAY,
    description: RSI_OVERBOUGHT_DROP_1H_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(RSI_OVERBOUGHT_DROP_1H_PARAMS),
  },
  {
    name: 'RSI_OVERBOUGHT_DROP_LEGACY_1H',
    displayName: RSI_OVERBOUGHT_DROP_LEGACY_1H_DISPLAY,
    description: RSI_OVERBOUGHT_DROP_LEGACY_1H_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(RSI_OVERBOUGHT_DROP_LEGACY_1H_PARAMS),
  },
  {
    name: 'PIVOT_BOSS_BEAR_15M',
    displayName: PIVOT_BOSS_BEAR_15M_DISPLAY,
    description: PIVOT_BOSS_BEAR_15M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(PIVOT_BOSS_BEAR_15M_PARAMS),
  },
  {
    name: 'PIVOT_BOSS_BEAR_1H',
    displayName: PIVOT_BOSS_BEAR_1H_DISPLAY,
    description: PIVOT_BOSS_BEAR_1H_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(PIVOT_BOSS_BEAR_1H_PARAMS),
  },
  {
    name: 'SCANNER1_TOP8',
    displayName: SCANNER1_TOP8_DISPLAY,
    description: SCANNER1_TOP8_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER1_TOP8_PARAMS),
  },
  {
    name: 'SCANNER_MA80_TOP6',
    displayName: SCANNER_MA80_TOP6_DISPLAY,
    description: SCANNER_MA80_TOP6_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER_MA80_TOP6_PARAMS),
  },
  {
    name: 'SCANNER_MA80_4H_TOP6',
    displayName: SCANNER_MA80_4H_TOP6_DISPLAY,
    description: SCANNER_MA80_4H_TOP6_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER_MA80_4H_TOP6_PARAMS),
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
  const rsiSync = await syncRsiOverboughtDrop1hConfig(prisma);
  if (rsiSync.updated) {
    console.log('✅ RSI_OVERBOUGHT_DROP_1H: params/descrição actualizados (pullback bear 1h)');
  }
  const rsiLegacySync = await syncRsiOverboughtDropLegacy1hConfig(prisma);
  if (rsiLegacySync.updated) {
    console.log('✅ RSI_OVERBOUGHT_DROP_LEGACY_1H: params/descrição actualizados (TP 50/30/28%)');
  }
  const af30mSync = await syncAfastamentoMedio30mBuyPrevMax(prisma);
  if (af30mSync.updated) {
    console.log('✅ AFASTAMENTO_MEDIO_30M: COMPRA/VENDA ≤2↔≥2,3 (30m) + maxStrength 75');
  }
  const emaRibbonSync = await syncEmaRibbonScalpingBuy15m(prisma);
  if (emaRibbonSync.updated) {
    console.log('✅ EMA_SCALPING: Ribbon BUY 15m activo (retração em tendência de alta); SELL desactivado');
  }
  const pivotBossSync = await syncPivotBossBear15mUniverse(prisma);
  if (pivotBossSync.updated) {
    console.log('✅ PIVOT_BOSS_BEAR: universo/descrição actualizados (15m → Scanner 1; 1h → Scanner 4)');
  }
  const s1Top8Sync = await syncScanner1Top8Config(prisma);
  if (s1Top8Sync.updated) {
    console.log('✅ SCANNER1_TOP8: params/descrição actualizados (Top 6 excl. ranks 3–4, rotação 4h, SL -5%)');
  }
  const ma80Top6Sync = await syncScannerMa80Top6Config(prisma);
  if (ma80Top6Sync.updated) {
    console.log('✅ SCANNER_MA80_TOP6: params/descrição actualizados (Top 6 excl. ranks 2–3, rotação diária, SL -5%)');
  }
  const ma804hTop6Sync = await syncScannerMa804hTop6Config(prisma);
  if (ma804hTop6Sync.updated) {
    console.log('✅ SCANNER_MA80_4H_TOP6: params/descrição actualizados (Top 6 excl. ranks 3–6, rotação 4h, SL -7%)');
  }
}
