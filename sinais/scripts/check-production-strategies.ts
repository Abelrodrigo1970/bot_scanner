/**
 * Verifica se a estratégia MA60_CROSSOVER (MA200) existe no banco.
 * Usa DATABASE_URL do ambiente - para produção: DATABASE_URL="postgresql://..." npx tsx scripts/check-production-strategies.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verificando estratégias no banco...\n');
  console.log('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@') || 'não definida');
  console.log('');

  const strategies = await prisma.strategy.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, displayName: true, isActive: true },
  });

  console.log(`📊 Total: ${strategies.length} estratégias\n`);

  const ma200 = strategies.find(
    (s) => s.name === 'MA60_CROSSOVER' || s.displayName?.toLowerCase().includes('ma200')
  );

  if (ma200) {
    console.log('✅ Estratégia MA200 encontrada:');
    console.log('   name:', ma200.name);
    console.log('   displayName:', ma200.displayName);
    console.log('   isActive:', ma200.isActive);
    console.log('   id:', ma200.id);
  } else {
    console.log('❌ Estratégia MA60_CROSSOVER / MA200 NÃO encontrada no banco.');
    console.log('');
    console.log('Estratégias existentes:');
    strategies.forEach((s) => console.log(`   - ${s.name} (${s.displayName})`));
  }
}

main()
  .catch((e) => {
    console.error('Erro:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
