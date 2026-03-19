/**
 * Script para preencher high24h e low24h de sinais já fechados
 * Execute: npx tsx scripts/fill-high-low-24h.ts
 * 
 * O script processa em lotes de 500 sinais por vez.
 * Execute múltiplas vezes até não haver mais sinais para atualizar.
 */

import { updateMissingHighLow24h } from '../lib/update24hResults';
import { prisma } from '../lib/db';

async function main() {
  console.log('🔄 Iniciando preenchimento de high24h e low24h...\n');
  
  try {
    // Verificar quantos sinais precisam ser atualizados
    const count = await prisma.signal.count({
      where: {
        status24h: 'CLOSED',
        OR: [
          { high24h: null },
          { low24h: null },
        ],
      },
    });
    
    console.log(`📊 Encontrados ${count} sinais fechados sem high24h/low24h\n`);
    
    if (count === 0) {
      console.log('✅ Todos os sinais já têm high24h e low24h preenchidos!\n');
      return;
    }
    
    let totalUpdated = 0;
    let totalErrors = 0;
    let iterations = 0;
    const maxIterations = Math.ceil(count / 500) + 5; // Processar em lotes + margem de segurança
    
    // Processar em loop até não haver mais sinais
    while (iterations < maxIterations) {
      iterations++;
      console.log(`\n📦 Lote ${iterations}...`);
      
      const result = await updateMissingHighLow24h();
      totalUpdated += result.updated;
      totalErrors += result.errors;
      
      console.log(`   Atualizados neste lote: ${result.updated}`);
      console.log(`   Erros neste lote: ${result.errors}`);
      
      // Se não atualizou nenhum, significa que terminou
      if (result.updated === 0) {
        break;
      }
      
      // Pequeno delay entre lotes
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    
    console.log('\n✅ Processo concluído!');
    console.log(`   Total atualizados: ${totalUpdated}`);
    console.log(`   Total erros: ${totalErrors}`);
    console.log(`   Lotes processados: ${iterations}\n`);
    
  } catch (error) {
    console.error('❌ Erro ao executar script:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

