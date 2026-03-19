/**
 * Script para verificar quais estratégias estão ativas no banco de dados
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verificando estratégias no banco de dados...\n');

  const strategies = await prisma.strategy.findMany({
    orderBy: { name: 'asc' },
  });

  if (strategies.length === 0) {
    console.log('❌ Nenhuma estratégia encontrada no banco de dados!');
    console.log('   Execute: npx tsx prisma/seed.ts');
    return;
  }

  console.log('═'.repeat(80));
  console.log('📊 ESTRATÉGIAS NO BANCO DE DADOS');
  console.log('─'.repeat(80));

  const activeStrategies = strategies.filter(s => s.isActive);
  const inactiveStrategies = strategies.filter(s => !s.isActive);

  console.log(`\n✅ Estratégias ATIVAS (${activeStrategies.length}):`);
  activeStrategies.forEach(s => {
    console.log(`   • ${s.name.padEnd(25)} - ${s.displayName}`);
  });

  if (inactiveStrategies.length > 0) {
    console.log(`\n❌ Estratégias INATIVAS (${inactiveStrategies.length}):`);
    inactiveStrategies.forEach(s => {
      console.log(`   • ${s.name.padEnd(25)} - ${s.displayName}`);
    });
  }

  const ma60Strategy = strategies.find(s => s.name === 'MA60_CROSSOVER');
  if (ma60Strategy) {
    console.log('\n═'.repeat(80));
    console.log('📋 DETALHES DA ESTRATÉGIA MA60_CROSSOVER:');
    console.log('─'.repeat(80));
    console.log(`   Nome: ${ma60Strategy.name}`);
    console.log(`   Display: ${ma60Strategy.displayName}`);
    console.log(`   Ativa: ${ma60Strategy.isActive ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   Descrição: ${ma60Strategy.description}`);
    console.log(`   Parâmetros: ${ma60Strategy.params}`);
  } else {
    console.log('\n⚠️  Estratégia MA60_CROSSOVER NÃO encontrada no banco de dados!');
    console.log('   Execute: npx tsx prisma/seed.ts');
  }

  console.log('\n═'.repeat(80));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
