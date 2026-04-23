/**
 * Corrige a base: VOLUME_SPIKE_15M → MA_CROSS_5M
 * (o seed no postbuild pode falhar silenciosamente com "|| true")
 *
 * Uso: cd sinais && npx tsx scripts/migrate-volume-spike-15m.ts
 *      ou: npm run db:migrate-vol-15m
 *
 * Atenção: usa DATABASE_URL do .env. O Postgres do Railway **não** é o
 * SQLite local — para corrigir produção, na shell faz:
 *   $env:DATABASE_URL="postgresql://...Railway..."; npm run db:migrate-vol-15m
 * ou chama POST /api/admin/migrate-volume-spike-15m no app em produção.
 */

import { PrismaClient } from '@prisma/client';
import { migrateVolumeSpike15mToMaCross5m } from '../lib/strategyMigrations';

function logDatasourceHint() {
  const u = process.env.DATABASE_URL || '';
  if (u.startsWith('file:')) {
    console.log('📁 DATABASE_URL: SQLite local →', u.slice(0, 40) + (u.length > 40 ? '…' : ''));
  } else if (u.startsWith('postgres')) {
    try {
      const { hostname } = new URL(u);
      console.log('🐘 DATABASE_URL: PostgreSQL @', hostname);
    } catch {
      console.log('🐘 DATABASE_URL: PostgreSQL (URL não percorrida)');
    }
  } else {
    console.log('⚠️  DATABASE_URL vazio ou desconhecido — confirma o .env');
  }
}

const prisma = new PrismaClient();

logDatasourceHint();

migrateVolumeSpike15mToMaCross5m(prisma)
  .then((r) => {
    console.log('Resultado:', r);
    if (r.action === 'already_ok' && (process.env.DATABASE_URL || '').startsWith('file:')) {
      console.log(
        '\n💡 Se a tabela ainda mostra VOLUME_SPIKE_15M no **Railway**, este comando correu no SQLite local. Usa a URL Postgres do Railway em DATABASE_URL ou o endpoint /api/admin/migrate-volume-spike-15m no servidor.\n'
      );
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
