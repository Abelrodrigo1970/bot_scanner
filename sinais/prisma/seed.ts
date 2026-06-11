import { PrismaClient } from '@prisma/client';
import {
  IMPORTED_BUILTIN_STRATEGY_SEEDS,
  TOP_ROTATION_STRATEGY_NAMES,
} from '../lib/ensureMissingBuiltinStrategies';
import {
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  MA_CROSS_5M_PARAMS,
  migrateVolumeSpike15mToMaCross5m,
  removeDeprecatedStrategies,
} from '../lib/strategyMigrations';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed do banco de dados (RSI + Volume)...');

  const deprecated = await removeDeprecatedStrategies(prisma);
  if (deprecated.removed.length > 0) {
    console.log(`[estratégias retiradas] ${deprecated.removed.join(', ')}`);
  }

  const mig = await migrateVolumeSpike15mToMaCross5m(prisma);
  console.log(`[migração VOLUME_SPIKE_15M] ${mig.action}: ${mig.message}`);
  if (mig.signalsReassigned != null) {
    console.log(`  sinais reatribuídos: ${mig.signalsReassigned}`);
  }
  if (mig.signalsRelabeled != null && mig.signalsRelabeled > 0) {
    console.log(`  strategyName em sinais (estatísticas): ${mig.signalsRelabeled} actualizados para "${MA_CROSS_5M_DISPLAY}"`);
  }

  // MA Cross 5m (MA12/MA30) — velas 5m; cron típico a cada 15 min
  const maCross5mStrategy = await prisma.strategy.upsert({
    where: { name: 'MA_CROSS_5M' },
    update: {
      displayName: MA_CROSS_5M_DISPLAY,
      description: MA_CROSS_5M_DESC,
      params: JSON.stringify(MA_CROSS_5M_PARAMS),
    },
    create: {
      name: 'MA_CROSS_5M',
      displayName: MA_CROSS_5M_DISPLAY,
      description: MA_CROSS_5M_DESC,
      isActive: true,
      params: JSON.stringify(MA_CROSS_5M_PARAMS),
    },
  });

  for (const def of IMPORTED_BUILTIN_STRATEGY_SEEDS) {
    await prisma.strategy.upsert({
      where: { name: def.name },
      update: {
        displayName: def.displayName,
        description: def.description,
        params: def.params,
      },
      create: def,
    });
  }
  console.log(`Estratégias importadas: ${IMPORTED_BUILTIN_STRATEGY_SEEDS.map((s) => s.name).join(', ')}`);

  await prisma.strategy.upsert({
    where: { name: 'EMA_SCALPING_SELL' },
    update: {
      displayName: 'EMA Ribbon Scalping SELL (15m)',
      description:
        'Scalping 15m «EMA Ribbon» só VENDA: fita descendente; pullback/consolidação à fita; vela bear forte abaixo da EMA rápida; SL acima do swing ou EMA lenta + folga; TP por R. Binance. Top movers 1h.',
      params: JSON.stringify({
        ribbonFastPeriod: 8,
        ribbonSlowPeriod: 55,
        atrPeriod: 14,
        slopeLookback: 5,
        minSlowEmaSlopePct: 0.85,
        consolidationLookback: 14,
        consolidationMaxRangePct: 1.35,
        pullbackMaxBars: 10,
        strongBodyOfRangeMin: 0.58,
        strongBodyMinAtrMult: 0.42,
        symbolLimit: 80,
        rewardRisk1: 1.65,
        rewardRisk2: 3.2,
        tp1PositionPct: 55,
        tp2PositionPct: 35,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'EMA_SCALPING_SELL',
      displayName: 'EMA Ribbon Scalping SELL (15m)',
      description:
        'Scalping 15m «EMA Ribbon» só VENDA: fita descendente; pullback/consolidação à fita; vela bear forte abaixo da EMA rápida; SL acima do swing ou EMA lenta + folga; TP por R. Binance. Top movers 1h.',
      isActive: false,
      params: JSON.stringify({
        ribbonFastPeriod: 8,
        ribbonSlowPeriod: 55,
        atrPeriod: 14,
        slopeLookback: 5,
        minSlowEmaSlopePct: 0.85,
        consolidationLookback: 14,
        consolidationMaxRangePct: 1.35,
        pullbackMaxBars: 10,
        strongBodyOfRangeMin: 0.58,
        strongBodyMinAtrMult: 0.42,
        symbolLimit: 80,
        rewardRisk1: 1.65,
        rewardRisk2: 3.2,
        tp1PositionPct: 55,
        tp2PositionPct: 35,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
  });

  // Remover estratégias legadas (não incluir MACD_HISTOGRAM_PMO / afastamento / RSI importados)
  const removed = await prisma.strategy.deleteMany({
    where: {
      name: {
        in: [
          'MACD_HISTOGRAM',
          'MA60_CROSSOVER',
          'SCANNER_APLUS',
          'MULTI_TIMEFRAME',
          'PMO',
          'MA_CROSSOVER',
          'MACD',
          ...deprecated.removed,
        ],
      },
    },
  });

  if (removed.count > 0) {
    console.log(`Removidas ${removed.count} estratégias antigas`);
  }

  const topRemoved = await prisma.strategy.deleteMany({
    where: { name: { in: [...TOP_ROTATION_STRATEGY_NAMES] } },
  });
  if (topRemoved.count > 0) {
    console.log(`Removidas ${topRemoved.count} estratégias Top (bot_cripto)`);
  }

  // Configuração: trades na Binance desativados por defeito
  await prisma.appSetting.upsert({
    where: { key: 'trading_enabled' },
    update: {},
    create: { key: 'trading_enabled', value: 'false' },
  });

  console.log('Seed concluído!');
  console.log('Estratégias (ids):', {
    maCross5m: maCross5mStrategy.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
