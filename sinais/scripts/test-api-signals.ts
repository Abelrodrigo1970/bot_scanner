/**
 * Script para testar a API de sinais e verificar o que está sendo retornado
 * Simula exatamente o que o frontend faz
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testApiQuery() {
  console.log('🔍 Testando query da API de sinais...\n');

  // Simular exatamente o que a API faz (sem autenticação para teste)
  const where: any = {};

  // Não aplicar filtro de força (removido para teste)
  // where.strength = { gte: 40 }; // REMOVIDO

  console.log('📊 Query sem filtros:');
  console.log('   where:', JSON.stringify(where, null, 2));

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
  const ma60Signals = signals.filter(s => s.strategyName.includes('MA60') || s.strategy?.name === 'MA60_CROSSOVER');
  
  console.log(`📊 Sinais MA60 encontrados: ${ma60Signals.length}\n`);

  if (ma60Signals.length > 0) {
    console.log('═'.repeat(80));
    console.log('📋 SINAIS MA60:');
    console.log('─'.repeat(80));
    ma60Signals.forEach(s => {
      const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
      console.log(`   • ${s.symbol.padEnd(15)} ${s.direction.padEnd(4)} ${s.timeframe.padEnd(3)} | Força: ${s.strength.toString().padStart(3)} | Preço: ${s.entryPrice.toFixed(6).padStart(12)} | ${age}min atrás`);
    });
  } else {
    console.log('⚠️  Nenhum sinal MA60 encontrado na query!');
  }

  // Testar com filtro de força >= 40
  console.log('\n═'.repeat(80));
  console.log('📊 Testando com filtro de força >= 40:');
  console.log('─'.repeat(80));

  const whereWithStrength: any = {
    strength: { gte: 40 },
  };

  const signalsWithStrength = await prisma.signal.findMany({
    where: whereWithStrength,
    orderBy: { generatedAt: 'desc' },
    take: 50,
    include: {
      strategy: true,
    },
  });

  const ma60WithStrength = signalsWithStrength.filter(s => s.strategyName.includes('MA60') || s.strategy?.name === 'MA60_CROSSOVER');
  
  console.log(`   Total: ${signalsWithStrength.length}`);
  console.log(`   MA60: ${ma60WithStrength.length}`);

  // Testar com filtro de força >= 0 (sem filtro)
  console.log('\n═'.repeat(80));
  console.log('📊 Testando com filtro de força >= 0 (todos):');
  console.log('─'.repeat(80));

  const whereAll: any = {
    strength: { gte: 0 },
  };

  const signalsAll = await prisma.signal.findMany({
    where: whereAll,
    orderBy: { generatedAt: 'desc' },
    take: 50,
    include: {
      strategy: true,
    },
  });

  const ma60All = signalsAll.filter(s => s.strategyName.includes('MA60') || s.strategy?.name === 'MA60_CROSSOVER');
  
  console.log(`   Total: ${signalsAll.length}`);
  console.log(`   MA60: ${ma60All.length}`);

  // Verificar estratégia
  console.log('\n═'.repeat(80));
  console.log('📊 Verificando estratégia MA60_CROSSOVER:');
  console.log('─'.repeat(80));

  const strategy = await prisma.strategy.findFirst({
    where: { name: 'MA60_CROSSOVER' },
  });

  if (strategy) {
    console.log(`   Nome: ${strategy.name}`);
    console.log(`   Display: ${strategy.displayName}`);
    console.log(`   Ativa: ${strategy.isActive}`);
    
    // Buscar sinais diretamente pela estratégia
    const signalsByStrategy = await prisma.signal.findMany({
      where: {
        strategyId: strategy.id,
      },
      orderBy: { generatedAt: 'desc' },
      take: 10,
    });

    console.log(`\n   Sinais diretos pela strategyId: ${signalsByStrategy.length}`);
    signalsByStrategy.forEach(s => {
      console.log(`     • ${s.symbol} ${s.direction} | Força: ${s.strength} | strategyName: "${s.strategyName}"`);
    });
  }

  console.log('\n═'.repeat(80));
}

testApiQuery()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
