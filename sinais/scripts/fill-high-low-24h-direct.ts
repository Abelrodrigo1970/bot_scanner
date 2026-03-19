/**
 * Script direto para preencher high24h e low24h
 * Conecta diretamente ao banco e atualiza os dados
 * Execute: npx tsx scripts/fill-high-low-24h-direct.ts
 */

import { prisma } from '../lib/db';
import { fetchCandles } from '../lib/marketData';

async function updateSignalHighLow(signal: any) {
  try {
    const price24h = signal.price24h;
    if (!price24h) {
      console.log(`⚠️  Sinal ${signal.symbol} não tem price24h, pulando...`);
      return { updated: false, error: 'Sem price24h' };
    }

    // Encontrar o timestamp do sinal e 24 horas depois
    const signalTimestamp = signal.generatedAt.getTime();
    const endTimestamp = signalTimestamp + (24 * 60 * 60 * 1000);

    // Buscar candles recentes (últimas 48 horas)
    const allCandles = await fetchCandles(signal.symbol, '1h', 48);

    // Filtrar candles que estão dentro do período de 24h após o sinal
    const relevantCandles = allCandles.filter((candle) => {
      const candleStart = candle.timestamp;
      const candleEnd = candleStart + (60 * 60 * 1000); // 1 hora depois

      return (
        (candleStart >= signalTimestamp && candleStart <= endTimestamp) ||
        (candleStart < signalTimestamp && candleEnd > signalTimestamp) ||
        (candleStart < endTimestamp && candleEnd > endTimestamp)
      );
    });

    let high24h: number | null = null;
    let low24h: number | null = null;

    if (relevantCandles.length > 0) {
      high24h = Math.max(...relevantCandles.map((c) => c.high));
      low24h = Math.min(...relevantCandles.map((c) => c.low));
      high24h = Math.max(high24h, signal.entryPrice, price24h);
      low24h = Math.min(low24h, signal.entryPrice, price24h);
    } else {
      high24h = Math.max(price24h, signal.entryPrice);
      low24h = Math.min(price24h, signal.entryPrice);
    }

    // Atualizar sinal
    await prisma.signal.update({
      where: { id: signal.id },
      data: {
        high24h,
        low24h,
      },
    });

    return { updated: true, high24h, low24h };
  } catch (error) {
    console.error(`❌ Erro ao atualizar sinal ${signal.id}:`, error);
    return { updated: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}

async function main() {
  console.log('🔄 Iniciando preenchimento de high24h e low24h...\n');

  try {
    // Verificar quantos sinais precisam ser atualizados
    const count = await prisma.signal.count({
      where: {
        status24h: 'CLOSED',
        price24h: { not: null },
        OR: [{ high24h: null }, { low24h: null }],
      },
    });

    console.log(`📊 Encontrados ${count} sinais fechados sem high24h/low24h\n`);

    if (count === 0) {
      console.log('✅ Todos os sinais já têm high24h e low24h preenchidos!\n');
      await prisma.$disconnect();
      return;
    }

    let totalUpdated = 0;
    let totalErrors = 0;
    let processed = 0;
    const batchSize = 50;

    // Processar em lotes
    while (processed < count) {
      const signals = await prisma.signal.findMany({
        where: {
          status24h: 'CLOSED',
          price24h: { not: null },
          OR: [{ high24h: null }, { low24h: null }],
        },
        take: batchSize,
        orderBy: { generatedAt: 'desc' },
      });

      if (signals.length === 0) {
        break;
      }

      console.log(`\n📦 Processando lote: ${signals.length} sinais...`);

      for (const signal of signals) {
        processed++;
        const result = await updateSignalHighLow(signal);

        if (result.updated) {
          totalUpdated++;
          if (totalUpdated % 10 === 0) {
            console.log(`   ✅ ${totalUpdated} atualizados...`);
          }
        } else {
          totalErrors++;
        }

        // Pequeno delay para não sobrecarregar API
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      console.log(`   Lote concluído: ${totalUpdated} atualizados, ${totalErrors} erros`);
    }

    console.log('\n✅ Processo concluído!');
    console.log(`   Total atualizados: ${totalUpdated}`);
    console.log(`   Total erros: ${totalErrors}\n`);
  } catch (error) {
    console.error('❌ Erro ao executar script:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

