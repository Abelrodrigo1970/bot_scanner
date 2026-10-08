import type { PrismaClient } from '@prisma/client';

import { mapLiquidityPoolSignalStrength } from './liquidityPoolsPro15mStrategy';

export {
  DISCONTINUED_STRATEGY_NAMES,
  DEPRECATED_TOP_ROTATION_NAMES,
  TOP_ROTATION_STRATEGY_NAMES,
} from './strategyNameLists';

import {
  DISCONTINUED_STRATEGY_NAMES,
  DEPRECATED_TOP_ROTATION_NAMES,
} from './strategyNameLists';

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
  SCANNER3_RSI_BREAKOUT_15M_DESCRIPTION,
  SCANNER3_RSI_BREAKOUT_15M_DISPLAY,
  SCANNER3_RSI_BREAKOUT_15M_PARAMS,
  SCANNER3_RSI_FLIP_1H_DESCRIPTION,
  SCANNER3_RSI_FLIP_1H_DISPLAY,
  SCANNER3_RSI_FLIP_1H_PARAMS,
  SCANNER2_STOCH_RSI_5M_DESCRIPTION,
  SCANNER2_STOCH_RSI_5M_DISPLAY,
  SCANNER2_STOCH_RSI_5M_PARAMS,
  SCANNER2_RSI80_TOP3_LONG_4H_DESCRIPTION,
  SCANNER2_RSI80_TOP3_LONG_4H_DISPLAY,
  SCANNER2_RSI80_TOP3_LONG_4H_PARAMS,
  STCH15LONG_DESCRIPTION,
  STCH15LONG_DISPLAY,
  STCH15LONG_PARAMS,
  RSI_VENDIDO_4H_DESCRIPTION,
  RSI_VENDIDO_4H_DISPLAY,
  RSI_VENDIDO_4H_PARAMS,
  RSI_1H_LONG_DESCRIPTION,
  RSI_1H_LONG_DISPLAY,
  RSI_1H_LONG_PARAMS,
  RSI_QQQ_DESCRIPTION,
  RSI_QQQ_DISPLAY,
  RSI_QQQ_PARAMS,
  MA_CROSS_12X21_S2_DESC,
  MA_CROSS_12X21_S2_DISPLAY,
  MA_CROSS_12X21_S2_PARAMS,
  ENGOLFO_15M_DESC,
  ENGOLFO_15M_DISPLAY,
  ENGOLFO_15M_PARAMS,
  LIQUIDITY_POOLS_PRO_15M_DESC,
  LIQUIDITY_POOLS_PRO_15M_DISPLAY,
  LIQUIDITY_POOLS_PRO_15M_PARAMS,
  SWING_ANCHORED_VWAP_15M_DESC,
  SWING_ANCHORED_VWAP_15M_DISPLAY,
  SWING_ANCHORED_VWAP_15M_PARAMS,
  ROMPIMENTO_20_15M_DESC,
  ROMPIMENTO_20_15M_DISPLAY,
  ROMPIMENTO_20_15M_PARAMS,
  RUMERS_BOX_15M_DESC,
  RUMERS_BOX_15M_DISPLAY,
  RUMERS_BOX_15M_PARAMS,
  deactivateDeprecatedStrategies,
  syncMaCrossScanner1UniverseDescriptions,
  syncMaCross12x21Scanner2Config,
  syncEngolfo15mConfig,
  syncLiquidityPoolsPro15mConfig,
  syncSwingAnchoredVwap15mConfig,
  syncRompimento20_15mConfig,
  syncRumersBox15mConfig,
  syncRsiVendido4hConfig,
  syncRsi1hLongConfig,
  syncRsiQqqConfig,
  syncPivotBossBear15mUniverse,
  syncScanner1Top5Config,
  syncAccumulationBreakout15mConfig,
  syncEma80Sma7Breakdown15mConfig,
  syncScanner3RsiBreakout15mConfig,
  syncScanner3RsiFlip1hConfig,
  syncScanner2StochRsi5mConfig,
  migrateScannerS6ShortToScanner2ShortLeader24h,
  syncScanner2ShortLeader24hConfig,
  SCANNER2_SHORT_LEADER_24H_DESCRIPTION,
  SCANNER2_SHORT_LEADER_24H_DISPLAY,
  SCANNER2_SHORT_LEADER_24H_PARAMS,
  migrateScanner2StrategiesToBybit,
  migrateActiveStrategiesExchangeToBybit,
  repairCorruptedStrategyParams,
} from './strategyMigrations';

/** Estratégias de sinal no bot_scanner (Scanner 1). */
export const IMPORTED_BUILTIN_STRATEGY_SEEDS = [
  {
    name: 'PIVOT_BOSS_BEAR_15M',
    displayName: PIVOT_BOSS_BEAR_15M_DISPLAY,
    description: PIVOT_BOSS_BEAR_15M_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(PIVOT_BOSS_BEAR_15M_PARAMS),
  },
  {
    name: 'SCANNER1_TOP5',
    displayName: SCANNER1_TOP5_DISPLAY,
    description: SCANNER1_TOP5_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(SCANNER1_TOP5_PARAMS),
  },
  {
    name: 'ACCUMULATION_BREAKOUT_15M',
    displayName: ACCUMULATION_BREAKOUT_15M_DISPLAY,
    description: ACCUMULATION_BREAKOUT_15M_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(ACCUMULATION_BREAKOUT_15M_PARAMS),
  },
  {
    name: 'EMA80_SMA7_BREAKDOWN_15M',
    displayName: EMA80_SMA7_BREAKDOWN_15M_DISPLAY,
    description: EMA80_SMA7_BREAKDOWN_15M_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(EMA80_SMA7_BREAKDOWN_15M_PARAMS),
  },
  {
    name: 'SCANNER2_SHORT_LEADER_24H',
    displayName: SCANNER2_SHORT_LEADER_24H_DISPLAY,
    description: SCANNER2_SHORT_LEADER_24H_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(SCANNER2_SHORT_LEADER_24H_PARAMS),
  },
  {
    name: 'SCANNER3_RSI_BREAKOUT_15M',
    displayName: SCANNER3_RSI_BREAKOUT_15M_DISPLAY,
    description: SCANNER3_RSI_BREAKOUT_15M_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(SCANNER3_RSI_BREAKOUT_15M_PARAMS),
  },
  {
    name: 'SCANNER3_RSI_FLIP_1H',
    displayName: SCANNER3_RSI_FLIP_1H_DISPLAY,
    description: SCANNER3_RSI_FLIP_1H_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(SCANNER3_RSI_FLIP_1H_PARAMS),
  },
  {
    name: 'SCANNER2_STOCH_RSI_5M',
    displayName: SCANNER2_STOCH_RSI_5M_DISPLAY,
    description: SCANNER2_STOCH_RSI_5M_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(SCANNER2_STOCH_RSI_5M_PARAMS),
  },
  {
    name: 'SCANNER2_RSI80_TOP3_LONG_4H',
    displayName: SCANNER2_RSI80_TOP3_LONG_4H_DISPLAY,
    description: SCANNER2_RSI80_TOP3_LONG_4H_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(SCANNER2_RSI80_TOP3_LONG_4H_PARAMS),
  },
  {
    name: 'STCH15LONG',
    displayName: STCH15LONG_DISPLAY,
    description: STCH15LONG_DESCRIPTION,
    isActive: false,
    params: JSON.stringify(STCH15LONG_PARAMS),
  },
  {
    name: 'RSI_VENDIDO_4H',
    displayName: RSI_VENDIDO_4H_DISPLAY,
    description: RSI_VENDIDO_4H_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(RSI_VENDIDO_4H_PARAMS),
  },
  {
    name: 'RSI_1H_LONG',
    displayName: RSI_1H_LONG_DISPLAY,
    description: RSI_1H_LONG_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(RSI_1H_LONG_PARAMS),
  },
  {
    name: 'RSI_QQQ',
    displayName: RSI_QQQ_DISPLAY,
    description: RSI_QQQ_DESCRIPTION,
    isActive: true,
    params: JSON.stringify(RSI_QQQ_PARAMS),
  },
  {
    name: 'MA_CROSS_12X21_S2',
    displayName: MA_CROSS_12X21_S2_DISPLAY,
    description: MA_CROSS_12X21_S2_DESC,
    isActive: true,
    params: JSON.stringify(MA_CROSS_12X21_S2_PARAMS),
  },
  {
    name: 'ENGOLFO_15M',
    displayName: ENGOLFO_15M_DISPLAY,
    description: ENGOLFO_15M_DESC,
    isActive: true,
    params: JSON.stringify(ENGOLFO_15M_PARAMS),
  },
  {
    name: 'LIQUIDITY_POOLS_PRO_15M',
    displayName: LIQUIDITY_POOLS_PRO_15M_DISPLAY,
    description: LIQUIDITY_POOLS_PRO_15M_DESC,
    isActive: true,
    params: JSON.stringify(LIQUIDITY_POOLS_PRO_15M_PARAMS),
  },
  {
    name: 'SWING_ANCHORED_VWAP_15M',
    displayName: SWING_ANCHORED_VWAP_15M_DISPLAY,
    description: SWING_ANCHORED_VWAP_15M_DESC,
    isActive: false,
    params: JSON.stringify(SWING_ANCHORED_VWAP_15M_PARAMS),
  },
  {
    name: 'ROMPIMENTO_20_15M',
    displayName: ROMPIMENTO_20_15M_DISPLAY,
    description: ROMPIMENTO_20_15M_DESC,
    isActive: true,
    params: JSON.stringify(ROMPIMENTO_20_15M_PARAMS),
  },
  {
    name: 'RUMERS_BOX_15M',
    displayName: RUMERS_BOX_15M_DISPLAY,
    description: RUMERS_BOX_15M_DESC,
    isActive: true,
    params: JSON.stringify(RUMERS_BOX_15M_PARAMS),
  },
] as const;

/** Seeds builtin — ver sync em ensureMissingBuiltinStrategies. */

export async function ensureMissingBuiltinStrategies(prisma: PrismaClient): Promise<void> {
  await deactivateDeprecatedStrategies(prisma, [...DEPRECATED_TOP_ROTATION_NAMES]);

  const repairedParams = await repairCorruptedStrategyParams(prisma);
  if (repairedParams.repaired.length > 0) {
    console.log(
      `✅ Params corrompidos (chaves numéricas) reparados: ${repairedParams.repaired.join(', ')}`
    );
  }

  for (const def of IMPORTED_BUILTIN_STRATEGY_SEEDS) {
    const existing = await prisma.strategy.findUnique({ where: { name: def.name } });

    if (!existing) {
      await prisma.strategy.create({ data: def });
      console.log(`✅ Estratégia criada: ${def.name}`);
    }
  }

  const maCrossSync = await syncMaCrossScanner1UniverseDescriptions(prisma);
  if (maCrossSync.updated.length > 0) {
    console.log(`✅ MA_CROSS_5M: display/descrição Scanner 3 (${maCrossSync.updated.join(', ')})`);
  }

  const maCross12x21Sync = await syncMaCross12x21Scanner2Config(prisma);
  if (maCross12x21Sync.updated) {
    console.log('✅ MA_CROSS_12X21_S2: MA12×21 15m | Scanner 6 SMA80 4h | só COMPRA | spread 0,6–1,5%');
  }

  const engolfoSync = await syncEngolfo15mConfig(prisma);
  if (engolfoSync.updated) {
    console.log('✅ ENGOLFO_15M: engolfo | EMA12/21 ou spread<2% | SELL 15m | Scanner 7 top 3 | SL +8% | TP1 −20% 50% | 24h');
  }

  const liquidityPoolsSync = await syncLiquidityPoolsPro15mConfig(prisma);
  if (liquidityPoolsSync.updated) {
    console.log('✅ LIQUIDITY_POOLS_PRO_15M: sweep mitigation 15m | Scanner 7 top 15 | SL 1,5×ATR | TP 1R/2R/3R');
  }

  const lpStrategy = await prisma.strategy.findUnique({
    where: { name: 'LIQUIDITY_POOLS_PRO_15M' },
    select: { id: true },
  });
  if (lpStrategy) {
    const lpOpen = await prisma.signal.findMany({
      where: {
        strategyId: lpStrategy.id,
        status: { in: ['NEW', 'IN_PROGRESS'] },
        strength: { lt: 60 },
      },
      select: { id: true, strength: true, extraInfo: true },
    });
    for (const sig of lpOpen) {
      let poolStrength = sig.strength;
      if (sig.extraInfo) {
        try {
          const ex = JSON.parse(sig.extraInfo) as { poolStrength?: number };
          if (typeof ex.poolStrength === 'number') poolStrength = ex.poolStrength;
        } catch {
          /* ignore */
        }
      }
      await prisma.signal.update({
        where: { id: sig.id },
        data: { strength: mapLiquidityPoolSignalStrength(poolStrength) },
      });
    }
    if (lpOpen.length > 0) {
      console.log(`✅ LIQUIDITY_POOLS_PRO_15M: ${lpOpen.length} sinal(is) abertos com força <60 actualizados para o dashboard`);
    }
  }

  const swingVwapSync = await syncSwingAnchoredVwap15mConfig(prisma);
  if (swingVwapSync.updated) {
    console.log('⏸️ SWING_ANCHORED_VWAP_15M desactivada');
  }

  const rompimentoSync = await syncRompimento20_15mConfig(prisma);
  if (rompimentoSync.updated) {
    console.log(
      '✅ ROMPIMENTO_20_15M: Rompimento 20 | fecho > HH20 | filtro ≤30% acima EMA70 | Stoch K<30 (50/40/11) | LONG 15m | Scanner 6 top 40 (4h) | SL −5% | TP1 +9% 50% | 24h'
    );
  }

  const rumersBoxSync = await syncRumersBox15mConfig(prisma);
  if (rumersBoxSync.updated) {
    console.log(
      "✅ RUMERS_BOX_15M: Rumer's Box BUY | PDH | Scanner 1 top 50 | SL −12% | TP1 +65% 50% | resto@72h"
    );
  }

  const rsiVendidoSync = await syncRsiVendido4hConfig(prisma);
  if (rsiVendidoSync.updated) {
    console.log(
      '✅ RSI_VENDIDO_4H: rsi_vendido 4h | Scanner 1 top50 | EMA21+0,8% | sai <EMA21 | cron 4em4h Lisboa | SL −8%'
    );
  }

  const rsi1hLongSync = await syncRsi1hLongConfig(prisma);
  if (rsi1hLongSync.updated) {
    console.log(
      '✅ RSI_1H_LONG: rsi_1h_long | Scanner 1 completo | EMA12 cross↑ + RSI azul <40 | dist EMA70d <40% | TP 19%/39% | 72h | SL −7%'
    );
  }

  const rsiQqqSync = await syncRsiQqqConfig(prisma);
  if (rsiQqqSync.updated) {
    console.log(
      '✅ RSI_QQQ: rsi_qqq | top30 stocks+QQQ 1h | LONG RSI SMA18 ↑34 TP +2/@50 +5/@50 SL −4% | SHORT EMA20↓70 TP −5% SL +6%'
    );
  }

  const pivotBossSync = await syncPivotBossBear15mUniverse(prisma);
  if (pivotBossSync.updated) {
    console.log('⏸️ PIVOT_BOSS_BEAR_15M sync (descontinuada)');
  }

  const top5Sync = await syncScanner1Top5Config(prisma);
  if (top5Sync.updated) {
    console.log('✅ SCANNER1_TOP5: Scanner 2 Top 4 + rotação 4h actualizados');
  }

  const breakoutSync = await syncAccumulationBreakout15mConfig(prisma);
  if (breakoutSync.updated) {
    console.log('⏸️ ACCUMULATION_BREAKOUT_15M desactivada');
  }

  const ema80BreakdownSync = await syncEma80Sma7Breakdown15mConfig(prisma);
  if (ema80BreakdownSync.updated) {
    console.log('⏸️ EMA80_SMA7_BREAKDOWN_15M desactivada');
  }

  const migratedShort = await migrateScannerS6ShortToScanner2ShortLeader24h(prisma);
  if (migratedShort.migrated) {
    console.log('✅ SCANNER_S6_SHORT_LEADER_12H → SCANNER2_SHORT_LEADER_24H (migrado)');
  }

  const s2Bybit = await migrateScanner2StrategiesToBybit(prisma);
  if (s2Bybit.migrated.length > 0) {
    console.log(`✅ Scanner 2 → Bybit: ${s2Bybit.migrated.join(', ')}`);
  }

  const activeBybit = await migrateActiveStrategiesExchangeToBybit(prisma);
  if (activeBybit.migrated.length > 0) {
    console.log(`✅ Activas → Bybit: ${activeBybit.migrated.join(', ')}`);
  }

  const s2ShortSync = await syncScanner2ShortLeader24hConfig(prisma);
  if (s2ShortSync.updated) {
    console.log('⏸️ SCANNER2_SHORT_LEADER_24H desactivada');
  }

  const scanner3Sync = await syncScanner3RsiBreakout15mConfig(prisma);
  if (scanner3Sync.updated) {
    console.log('✅ SCANNER3_RSI_BREAKOUT_15M: Scanner 3 RSI Rompimento 1h actualizado');
  }

  const scanner3FlipSync = await syncScanner3RsiFlip1hConfig(prisma);
  if (scanner3FlipSync.updated) {
    console.log('⏸️ SCANNER3_RSI_FLIP_1H desactivada');
  }

  const stoch5mSync = await syncScanner2StochRsi5mConfig(prisma);
  if (stoch5mSync.updated) {
    console.log('⏸️ SCANNER2_STOCH_RSI_5M desactivada (Stoch RSI Top 4 5m descontinuada)');
  }

  const discontinued = await prisma.strategy.updateMany({
    where: {
      name: { in: [...DISCONTINUED_STRATEGY_NAMES] },
      isActive: true,
    },
    data: { isActive: false },
  });
  if (discontinued.count > 0) {
    console.log(`⏸️ ${discontinued.count} estratégias descontinuadas forçadas inactivas`);
  }

  const expiredDiscontinued = await prisma.signal.updateMany({
    where: {
      strategy: { name: { in: [...DISCONTINUED_STRATEGY_NAMES] } },
      status: { in: ['NEW', 'IN_PROGRESS'] },
    },
    data: { status: 'EXPIRED' },
  });
  if (expiredDiscontinued.count > 0) {
    console.log(
      `⏸️ ${expiredDiscontinued.count} sinais NEW/IN_PROGRESS de estratégias descontinuadas → EXPIRED (fechar Bybit manualmente se necessário)`
    );
  }
}
