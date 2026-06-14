import { PrismaClient } from '@prisma/client';
import {
  IMPORTED_BUILTIN_STRATEGY_SEEDS,
  DEPRECATED_TOP_ROTATION_NAMES,
} from '../lib/ensureMissingBuiltinStrategies';
import {
  deleteStrategiesByNameIfNoSignals,
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  MA_CROSS_5M_PARAMS,
  migrateVolumeSpike15mToMaCross5m,
  deactivateDeprecatedStrategies,
  removeDeprecatedStrategies,
} from '../lib/strategyMigrations';

const LEGACY_STRATEGY_NAMES_TO_PURGE = [
  'MACD_HISTOGRAM',
  'MA60_CROSSOVER',
  'SCANNER_APLUS',
  'MULTI_TIMEFRAME',
  'PMO',
  'MA_CROSSOVER',
  'MACD',
] as const;

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed do banco de dados (RSI + Volume)...');

  const deprecated = await removeDeprecatedStrategies(prisma);
  if (deprecated.removed.length > 0) {
    console.log(`[estratégias retiradas] ${deprecated.removed.join(', ')}`);
  }
  await deactivateDeprecatedStrategies(prisma, [...DEPRECATED_TOP_ROTATION_NAMES]);

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

  // Legadas / Top sem sinais (com histórico nunca apaga)
  await deleteStrategiesByNameIfNoSignals(prisma, [
    ...LEGACY_STRATEGY_NAMES_TO_PURGE,
    ...deprecated.removed,
    ...DEPRECATED_TOP_ROTATION_NAMES,
  ]);

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
