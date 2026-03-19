/**
 * Script para verificar a ordem dos sinais e por que os MA60 não aparecem nos primeiros 50
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSignalOrder() {
  console.log('🔍 Verificando ordem dos sinais...\n');

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

  console.log(`📊 Total de sinais retornados: ${signals.length}\n`);

  // Separar por estratégia
  const byStrategy: Record<string, any[]> = {};
  signals.forEach(s => {
    const strategyName = s.strategyName || s.strategy?.name || 'Unknown';
    if (!byStrategy[strategyName]) {
      byStrategy[strategyName] = [];
    }
    byStrategy[strategyName].push(s);
  });

  console.log('═'.repeat(80));
  console.log('📋 Sinais por estratégia (primeiros 50):');
  console.log('─'.repeat(80));
  Object.entries(byStrategy).forEach(([strategy, sigs]) => {
    console.log(`\n${strategy}: ${sigs.length} sinais`);
    sigs.slice(0, 3).forEach(s => {
      const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
      console.log(`   - ${s.symbol} ${s.direction} | ${age}min atrás | força: ${s.strength}`);
    });
  });

  // Verificar sinais MA60
  const ma60Signals = signals.filter(s => 
    s.strategyName?.includes('MA60') || s.strategy?.name === 'MA60_CROSSOVER'
  );

  console.log('\n═'.repeat(80));
  console.log(`📊 Sinais MA60 nos primeiros 50: ${ma60Signals.length}`);
  console.log('─'.repeat(80));

  if (ma60Signals.length === 0) {
    console.log('⚠️  Nenhum sinal MA60 nos primeiros 50!');
    console.log('\n🔍 Verificando todos os sinais MA60 no banco...\n');
    
    const allMa60 = await prisma.signal.findMany({
      where: {
        OR: [
          { strategyName: { contains: 'MA60' } },
          { strategy: { name: 'MA60_CROSSOVER' } },
        ],
        strength: { gte: 40 },
      },
      orderBy: { generatedAt: 'desc' },
      take: 20,
      include: {
        strategy: true,
      },
    });

    console.log(`📊 Total de sinais MA60 no banco (com força >= 40): ${allMa60.length}\n`);
    
    if (allMa60.length > 0) {
      console.log('Primeiros 10 sinais MA60:');
      allMa60.slice(0, 10).forEach(s => {
        const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
        const position = signals.findIndex(sig => sig.id === s.id);
        console.log(`   - ${s.symbol} ${s.direction} | ${age}min atrás | força: ${s.strength} | posição nos 50: ${position >= 0 ? position + 1 : 'fora'}`);
      });

      // Verificar quantos sinais MACD foram criados depois dos MA60
      const oldestMa60 = allMa60[allMa60.length - 1];
      const newerMacd = await prisma.signal.count({
        where: {
          generatedAt: { gt: oldestMa60.generatedAt },
          strength: { gte: 40 },
          NOT: {
            OR: [
              { strategyName: { contains: 'MA60' } },
              { strategy: { name: 'MA60_CROSSOVER' } },
            ],
          },
        },
      });

      console.log(`\n📊 Sinais não-MA60 criados DEPOIS do MA60 mais antigo: ${newerMacd}`);
      console.log(`   Isso explica por que os MA60 não aparecem nos primeiros 50!`);
    }
  } else {
    ma60Signals.forEach(s => {
      const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
      console.log(`   - ${s.symbol} ${s.direction} | ${age}min atrás | força: ${s.strength}`);
    });
  }

  console.log('\n═'.repeat(80));
}

checkSignalOrder()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
