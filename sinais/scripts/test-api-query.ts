/**
 * Script para testar a query exata que a API faz com minStrength=40
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testApiQuery() {
  console.log('🔍 Testando query exata da API com minStrength=40...\n');

  // Simular exatamente o que a API faz
  const where: any = {
    strength: { gte: 40 },
  };

  console.log('📊 Query where:', JSON.stringify(where, null, 2));

  const signals = await prisma.signal.findMany({
    where,
    orderBy: { generatedAt: 'desc' },
    take: 50,
    include: {
      strategy: true,
    },
  });

  console.log(`\n✅ Total de sinais encontrados: ${signals.length}\n`);

  // Filtrar apenas MA60
  const ma60Signals = signals.filter(s => 
    s.strategyName?.includes('MA60') || s.strategy?.name === 'MA60_CROSSOVER'
  );
  
  console.log(`📊 Sinais MA60 encontrados: ${ma60Signals.length}\n`);

  if (ma60Signals.length > 0) {
    console.log('═'.repeat(80));
    console.log('📋 SINAIS MA60:');
    console.log('─'.repeat(80));
    ma60Signals.forEach(s => {
      console.log(`   • ${s.symbol.padEnd(15)} ${s.direction.padEnd(4)} | strategyName: "${s.strategyName}" | strategy.name: "${s.strategy?.name}"`);
    });
  } else {
    console.log('⚠️  Nenhum sinal MA60 encontrado!');
    console.log('\n📋 Primeiros 5 sinais retornados:');
    signals.slice(0, 5).forEach(s => {
      console.log(`   • ${s.symbol.padEnd(15)} ${s.direction.padEnd(4)} | strategyName: "${s.strategyName}" | strategy.name: "${s.strategy?.name}" | força: ${s.strength}`);
    });
  }

  // Verificar se há sinais MA60 sem o filtro de força
  console.log('\n═'.repeat(80));
  console.log('📊 Testando sem filtro de força (todos os sinais MA60):');
  console.log('─'.repeat(80));

  const allMa60Signals = await prisma.signal.findMany({
    where: {
      OR: [
        { strategyName: { contains: 'MA60' } },
        { strategy: { name: 'MA60_CROSSOVER' } },
      ],
    },
    orderBy: { generatedAt: 'desc' },
    take: 20,
    include: {
      strategy: true,
    },
  });

  console.log(`   Total de sinais MA60 (sem filtro de força): ${allMa60Signals.length}`);
  allMa60Signals.slice(0, 5).forEach(s => {
    console.log(`   • ${s.symbol} ${s.direction} | força: ${s.strength} | strategyName: "${s.strategyName}"`);
  });

  console.log('\n═'.repeat(80));
}

testApiQuery()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
