import type { PrismaClient } from '@prisma/client';

import {

  PIVOT_BOSS_BEAR_15M_DESCRIPTION,

  PIVOT_BOSS_BEAR_15M_PARAMS,

  PIVOT_BOSS_BEAR_15M_DISPLAY,

  syncMaCrossScanner1UniverseDescriptions,

  syncPivotBossBear15mUniverse,

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

] as const;



/** Nomes internos das estratégias Top (não usadas neste projeto). */

export const TOP_ROTATION_STRATEGY_NAMES = [

  'SCANNER1_TOP8',

  'SCANNER_MA80_TOP6',

  'SCANNER_MA80_4H_TOP6',

] as const;



export async function ensureMissingBuiltinStrategies(prisma: PrismaClient): Promise<void> {

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

}


