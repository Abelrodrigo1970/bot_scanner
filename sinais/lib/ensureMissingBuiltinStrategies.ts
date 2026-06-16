import type { PrismaClient } from '@prisma/client';

import {
  PIVOT_BOSS_BEAR_15M_DESCRIPTION,
  PIVOT_BOSS_BEAR_15M_PARAMS,
  PIVOT_BOSS_BEAR_15M_DISPLAY,
  SCANNER1_TOP8_DESCRIPTION,
  SCANNER1_TOP8_DISPLAY,
  SCANNER1_TOP8_PARAMS,
  SCANNER1_TOP5_DESCRIPTION,
  SCANNER1_TOP5_DISPLAY,
  SCANNER1_TOP5_PARAMS,
  ACCUMULATION_BREAKOUT_15M_DESCRIPTION,
  ACCUMULATION_BREAKOUT_15M_DISPLAY,
  ACCUMULATION_BREAKOUT_15M_PARAMS,
  SCANNER3_RSI_BREAKOUT_15M_DESCRIPTION,
  SCANNER3_RSI_BREAKOUT_15M_DISPLAY,
  SCANNER3_RSI_BREAKOUT_15M_PARAMS,
  deactivateDeprecatedStrategies,
  syncMaCrossScanner1UniverseDescriptions,
  syncPivotBossBear15mUniverse,
  syncScanner1Top8Config,
  syncScanner1Top5Config,
  syncAccumulationBreakout15mConfig,
  syncScanner3RsiBreakout15mConfig,
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
    name: 'SCANNER1_TOP8',
    displayName: SCANNER1_TOP8_DISPLAY,
    description: SCANNER1_TOP8_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER1_TOP8_PARAMS),
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
    name: 'SCANNER3_RSI_BREAKOUT_15M',
    displayName: SCANNER3_RSI_BREAKOUT_15M_DISPLAY,
    description: SCANNER3_RSI_BREAKOUT_15M_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(SCANNER3_RSI_BREAKOUT_15M_PARAMS),
  },
] as const;

/** Rotações Top de outros scanners (não usadas neste projeto). */
export const DEPRECATED_TOP_ROTATION_NAMES = [
  'SCANNER_MA80_TOP6',
  'SCANNER_MA80_4H_TOP6',
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

  const top6Sync = await syncScanner1Top8Config(prisma);
  if (top6Sync.updated) {
    console.log('✅ SCANNER1_TOP8: Top 6 + rotação 4h actualizados');
  }

  const top5Sync = await syncScanner1Top5Config(prisma);
  if (top5Sync.updated) {
    console.log('✅ SCANNER1_TOP5: Scanner 2 Top 8 + rotação 4h actualizados');
  }

  const breakoutSync = await syncAccumulationBreakout15mConfig(prisma);
  if (breakoutSync.updated) {
    console.log('✅ ACCUMULATION_BREAKOUT_15M: rompimento de acumulação actualizado');
  }

  const scanner3BreakoutSync = await syncScanner3RsiBreakout15mConfig(prisma);
  if (scanner3BreakoutSync.updated) {
    console.log('✅ SCANNER3_RSI_BREAKOUT_15M: Scanner 3 RSI rompimento actualizado');
  }

  const reactivated = await prisma.strategy.updateMany({
    where: { name: { in: ['SCANNER1_TOP8', 'SCANNER1_TOP5'] }, isActive: false },
    data: { isActive: true },
  });
  if (reactivated.count > 0) {
    console.log('✅ Rotações Scanner 1 reactivadas');
  }
}
