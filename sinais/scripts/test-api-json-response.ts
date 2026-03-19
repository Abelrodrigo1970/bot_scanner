/**
 * Script para simular exatamente o que a API retorna em JSON
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testApiJsonResponse() {
  console.log('🔍 Testando resposta JSON da API...\n');

  // Simular exatamente o que a API faz
  const where: any = {
    strength: { gte: 40 },
  };

  const signals = await prisma.signal.findMany({
    where,
    orderBy: { generatedAt: 'desc' },
    take: 50,
    include: {
      strategy: true,
    },
  });

  // Simular serialização JSON (como NextResponse.json faz)
  const jsonSignals = JSON.parse(JSON.stringify(signals));

  console.log(`📊 Total de sinais: ${jsonSignals.length}\n`);

  // Verificar sinais MA60
  const ma60Signals = jsonSignals.filter((s: any) => {
    const strategyName = s.strategyName || '';
    const strategyNameFromRelation = s.strategy?.name || '';
    return strategyName.includes('MA60') || strategyNameFromRelation === 'MA60_CROSSOVER';
  });

  console.log(`📊 Sinais MA60 encontrados: ${ma60Signals.length}\n`);

  if (ma60Signals.length > 0) {
    console.log('═'.repeat(80));
    console.log('📋 SINAIS MA60 (após serialização JSON):');
    console.log('─'.repeat(80));
    ma60Signals.slice(0, 5).forEach((s: any) => {
      console.log(`   • ${s.symbol} ${s.direction}`);
      console.log(`     strategyName: "${s.strategyName}"`);
      console.log(`     strategy.name: "${s.strategy?.name}"`);
      console.log(`     strategy object: ${JSON.stringify(s.strategy)}`);
      console.log('');
    });
  } else {
    console.log('⚠️  Nenhum sinal MA60 encontrado após serialização!\n');
    console.log('📋 Verificando estrutura dos primeiros 3 sinais:\n');
    jsonSignals.slice(0, 3).forEach((s: any) => {
      console.log(`   • ${s.symbol}`);
      console.log(`     strategyName: "${s.strategyName}"`);
      console.log(`     strategy: ${JSON.stringify(s.strategy)}`);
      console.log('');
    });
  }

  // Verificar se strategyName está presente
  const signalsWithStrategyName = jsonSignals.filter((s: any) => s.strategyName);
  console.log(`📊 Sinais com strategyName: ${signalsWithStrategyName.length} de ${jsonSignals.length}`);

  // Verificar se strategy relation está presente
  const signalsWithStrategy = jsonSignals.filter((s: any) => s.strategy);
  console.log(`📊 Sinais com strategy relation: ${signalsWithStrategy.length} de ${jsonSignals.length}`);

  console.log('\n═'.repeat(80));
}

testApiJsonResponse()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
