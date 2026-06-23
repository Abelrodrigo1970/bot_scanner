import type { PrismaClient } from '@prisma/client';

import {
  PIVOT_BOSS_BEAR_15M_DESCRIPTION,
  PIVOT_BOSS_BEAR_15M_PARAMS,
  PIVOT_BOSS_BEAR_15M_DISPLAY,
  SCANNER1_TOP5_DESCRIPTION,
  SCANNER1_TOP5_DISPLAY,
  SCANNER1_TOP5_PARAMS,
  ACCUMULATION_BREAKOUT_15M_DESCRIPTION,
  ACCUMULATION_BREAKOUT_15M_DISPLAY,
  ACCUMULATION_BREAKOUT_15M_PARAMS,
  EMA80_SMA7_BREAKDOWN_15M_DESCRIPTION,
  EMA80_SMA7_BREAKDOWN_15M_DISPLAY,
  EMA80_SMA7_BREAKDOWN_15M_PARAMS,
  deactivateDeprecatedStrategies,
  syncMaCrossScanner1UniverseDescriptions,
  syncPivotBossBear15mUniverse,
  syncScanner1Top5Config,
  syncAccumulationBreakout15mConfig,
  syncEma80Sma7Breakdown15mConfig,
  migrateScannerS6ShortToScanner2ShortLeader24h,
  syncScanner2ShortLeader24hConfig,
  SCANNER2_SHORT_LEADER_24H_DESCRIPTION,
  SCANNER2_SHORT_LEADER_24H_DISPLAY,
  SCANNER2_SHORT_LEADER_24H_PARAMS,
} from './strategyMigrations';

/** Estratégias de sinal no bot_scanner (Scanner 1). */
export const IMPORTED_BUILTIN_STRATEGY_SEEDS = [
  {
    name: 'PIVOT_BOSS_BEAR_15M',
    displayName: PIVOT_BOSS_BEAR_15M_DISPLAY,
    description: PIVOT_BOSS_BEAR_15M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(PIVOT_BOSS_BEAR_15M_PARAMS),
  },
  {
    name: 'SCANNER1_TOP5',
    displayName: SCANNER1_TOP5_DISPLAY,
    description: SCANNER1_TOP5_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER1_TOP5_PARAMS),
  },
  {
    name: 'ACCUMULATION_BREAKOUT_15M',
    displayName: ACCUMULATION_BREAKOUT_15M_DISPLAY,
    description: ACCUMULATION_BREAKOUT_15M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(ACCUMULATION_BREAKOUT_15M_PARAMS),
  },
  {
    name: 'EMA80_SMA7_BREAKDOWN_15M',
    displayName: EMA80_SMA7_BREAKDOWN_15M_DISPLAY,
    description: EMA80_SMA7_BREAKDOWN_15M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(EMA80_SMA7_BREAKDOWN_15M_PARAMS),
  },
  {
    name: 'SCANNER2_SHORT_LEADER_24H',
    displayName: SCANNER2_SHORT_LEADER_24H_DISPLAY,
    description: SCANNER2_SHORT_LEADER_24H_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER2_SHORT_LEADER_24H_PARAMS),
  },
] as const;

/** Rotações Top descontinuadas neste projeto. */
export const DEPRECATED_TOP_ROTATION_NAMES = [
  'SCANNER_MA80_TOP6',
  'SCANNER_MA80_4H_TOP6',
  'SCANNER1_TOP8',
  'SCANNER3_RSI_BREAKOUT_15M',
] as const;

/** @deprecated Use DEPRECATED_TOP_ROTATION_NAMES */
export const TOP_ROTATION_STRATEGY_NAMES = DEPRECATED_TOP_ROTATION_NAMES;

export async function ensureMissingBuiltinStrategies(prisma: PrismaClient): Promise<void> {
  await deactivateDeprecatedStrategies(prisma, [...DEPRECATED_TOP_ROTATION_NAMES]);

  for (const def of IMPORTED_BUILTIN_STRATEGY_SEEDS) {
    const existing = await prisma.strategy.findUnique({ where: { name: def.name } });

    if (!existing) {
      await prisma.strategy.create({ data: def });
      console.log(`✅ Estratégia criada: ${def.name}`);
    }
  }

  const maCrossSync = await syncMaCrossScanner1UniverseDescriptions(prisma);
  if (maCrossSync.updated.length > 0) {
    console.log(`✅ MA_CROSS_5M: display/descrição Scanner 1 (${maCrossSync.updated.join(', ')})`);
  }

  const pivotBossSync = await syncPivotBossBear15mUniverse(prisma);
  if (pivotBossSync.updated) {
    console.log('✅ PIVOT_BOSS_BEAR_15M: Scanner 1 + SL 7% actualizados');
  }

  const top5Sync = await syncScanner1Top5Config(prisma);
  if (top5Sync.updated) {
    console.log('✅ SCANNER1_TOP5: Scanner 2 Top 8 + rotação 4h actualizados');
  }

  const breakoutSync = await syncAccumulationBreakout15mConfig(prisma);
  if (breakoutSync.updated) {
    console.log('✅ ACCUMULATION_BREAKOUT_15M: rompimento de acumulação actualizado');
  }

  const ema80BreakdownSync = await syncEma80Sma7Breakdown15mConfig(prisma);
  if (ema80BreakdownSync.updated) {
    console.log('✅ EMA80_SMA7_BREAKDOWN_15M: Quebra EMA80 actualizada');
  }

  const migratedShort = await migrateScannerS6ShortToScanner2ShortLeader24h(prisma);
  if (migratedShort.migrated) {
    console.log('✅ SCANNER_S6_SHORT_LEADER_12H → SCANNER2_SHORT_LEADER_24H (migrado)');
  }

  const s2ShortSync = await syncScanner2ShortLeader24hConfig(prisma);
  if (s2ShortSync.updated) {
    console.log('✅ SCANNER2_SHORT_LEADER_24H: SHORT ranks #1–#2, pump ≥25%, hold 24h, SL +40%');
  }

  const reactivated = await prisma.strategy.updateMany({
    where: { name: 'SCANNER1_TOP5', isActive: false },
    data: { isActive: true },
  });
  if (reactivated.count > 0) {
    console.log('✅ Rotação Scanner 2 Top 8 reactivada');
  }
}
