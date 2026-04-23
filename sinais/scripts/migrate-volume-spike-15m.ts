/**
 * Corrige a base de produção: VOLUME_SPIKE_15M → MA_CROSS_5M
 * (o seed no postbuild pode falhar silenciosamente com "|| true")
 *
 * Uso: cd sinais && npx tsx scripts/migrate-volume-spike-15m.ts
 *      ou: npm run db:migrate-vol-15m
 */

import { PrismaClient } from '@prisma/client';
import { migrateVolumeSpike15mToMaCross5m } from '../lib/strategyMigrations';

const prisma = new PrismaClient();

migrateVolumeSpike15mToMaCross5m(prisma)
  .then((r) => {
    console.log('Resultado:', r);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
