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
  deactivateDeprecatedStrategies,
  syncMaCrossScanner1UniverseDescriptions,
  syncMaCross12x21Scanner2Config,
  syncEngolfo15mConfig,
  syncLiquidityPoolsPro15mConfig,
  syncSwingAnchoredVwap15mConfig,
  syncRompimento20_15mConfig,
  syncPivotBossBear15mUniverse,
  syncScanner1Top5Config,
  syncAccumulationBreakout15mConfig,
  syncEma80Sma7Breakdown15mConfig,
  syncScanner3RsiBreakout15mConfig,
  syncScanner3RsiFlip1hConfig,
  syncScanner2StochRsi5mConfig,
  syncScanner2Rsi80Top3Long4hConfig,
  syncStch15LongConfig,
  syncRsiVendido4hConfig,
  migrateScannerS6ShortToScanner2ShortLeader24h,
  syncScanner2ShortLeader24hConfig,
  SCANNER2_SHORT_LEADER_24H_DESCRIPTION,
  SCANNER2_SHORT_LEADER_24H_DISPLAY,
  SCANNER2_SHORT_LEADER_24H_PARAMS,
  migrateScanner2StrategiesToBybit,
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
    isActive: true,
    params: JSON.stringify(SCANNER2_RSI80_TOP3_LONG_4H_PARAMS),
  },
  {
    name: 'STCH15LONG',
    displayName: STCH15LONG_DISPLAY,
    description: STCH15LONG_DESCRIPTION,
    isActive: true,
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
    isActive: true,
    params: JSON.stringify(SWING_ANCHORED_VWAP_15M_PARAMS),
  },
  {
    name: 'ROMPIMENTO_20_15M',
    displayName: ROMPIMENTO_20_15M_DISPLAY,
    description: ROMPIMENTO_20_15M_DESC,
    isActive: true,
    params: JSON.stringify(ROMPIMENTO_20_15M_PARAMS),
  },
] as const;

/** Estratégias descontinuadas (Ago 2026) — manter registo/histórico, sem trading. */
export const DISCONTINUED_STRATEGY_NAMES = [
  'PIVOT_BOSS_BEAR_15M',
  'ACCUMULATION_BREAKOUT_15M',
  'EMA80_SMA7_BREAKDOWN_15M',
  'SCANNER2_SHORT_LEADER_24H',
  'SCANNER3_RSI_FLIP_1H',
  'SCANNER2_STOCH_RSI_5M',
  'SCANNER1_TOP5',
  'SCANNER3_RSI_BREAKOUT_15M',
] as const;

/** Rotações Top descontinuadas neste projeto. */
export const DEPRECATED_TOP_ROTATION_NAMES = [
  'SCANNER_MA80_TOP6',
  'SCANNER_MA80_4H_TOP6',
  'SCANNER1_TOP8',
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

  const maCross12x21Sync = await syncMaCross12x21Scanner2Config(prisma);
  if (maCross12x21Sync.updated) {
    console.log('✅ MA_CROSS_12X21_S2: MA12×21 15m | Scanner 7 RSI 1d ≥ 69 | só COMPRA | spread 0,6–1,5%');
  }

  const engolfoSync = await syncEngolfo15mConfig(prisma);
  if (engolfoSync.updated) {
    console.log('✅ ENGOLFO_15M: engolfo | EMA12/21 ou spread<2% | SELL 15m | Scanner 2 top 3 | SL +8% | TP1 −20% 50% | 24h');
  }

  const liquidityPoolsSync = await syncLiquidityPoolsPro15mConfig(prisma);
  if (liquidityPoolsSync.updated) {
    console.log('✅ LIQUIDITY_POOLS_PRO_15M: sweep mitigation 15m | Scanner 2 top 10 | SL 1,5×ATR | TP 1R/2R/3R');
  }

  const swingVwapSync = await syncSwingAnchoredVwap15mConfig(prisma);
  if (swingVwapSync.updated) {
    console.log('✅ SWING_ANCHORED_VWAP_15M: VWAP ancorado length 50 | flip trend | Scanner 2 top 15 | SL swing/5% | TP VWAP/10%');
  }

  const rompimentoSync = await syncRompimento20_15mConfig(prisma);
  if (rompimentoSync.updated) {
    console.log(
      '✅ ROMPIMENTO_20_15M: Rompimento 20 | fecho > HH20 | filtro ≤30% acima EMA70 | Stoch K<30 (50/40/11) | LONG 15m | Scanner 1 top 20 (1h) | SL −5% | TP1 +9% 50% | 24h'
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

  const rsi80Top3Sync = await syncScanner2Rsi80Top3Long4hConfig(prisma);
  if (rsi80Top3Sync.updated) {
    console.log('✅ SCANNER2_RSI80_TOP3_LONG_4H: Top 3 | RSI 4h >80 LONG | SL −10% | fecho 24h');
  }

  const stch15Sync = await syncStch15LongConfig(prisma);
  if (stch15Sync.updated) {
    console.log('✅ STCH15LONG (stch15long): Top 2 | Stoch 15m 20/15/11 LONG | SL −5% | exit K×D down');
  }

  const rsiVendidoSync = await syncRsiVendido4hConfig(prisma);
  if (rsiVendidoSync.updated) {
    console.log('✅ RSI_VENDIDO_4H: rsi_vendido | RSI 4h cruza <25 LONG | sai >32 | SL −5% | 24h');
  }
}
