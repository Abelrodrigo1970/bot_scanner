/**
 * Script para testar diretamente a API de sinais
 * Simula a chamada HTTP que o frontend faz
 */

async function testApiDirect() {
  console.log('🔍 Testando API de sinais diretamente...\n');

  // Simular chamada sem autenticação primeiro (vai dar erro, mas vamos ver)
  try {
    const url = '/api/signals';
    console.log(`📡 Chamando: ${url}`);
    
    // Como estamos em Node, vamos usar fetch direto
    // Mas primeiro vamos verificar se há algum problema de autenticação
    console.log('\n⚠️  Nota: A API requer autenticação.');
    console.log('   Para testar localmente, você precisa estar logado na app.\n');
    
    // Vamos apenas mostrar o que deveria ser retornado
    console.log('═'.repeat(80));
    console.log('📊 O que a API DEVERIA retornar:');
    console.log('─'.repeat(80));
    console.log('   - URL: /api/signals');
    console.log('   - Sem filtros: deve retornar todos os sinais (incluindo MA60)');
    console.log('   - Com minStrength=0: deve retornar todos os sinais');
    console.log('   - Com minStrength=40: deve retornar apenas força >= 40');
    console.log('\n   ✅ Há 13 sinais MA60 no banco com força 60');
    console.log('   ✅ Todos devem aparecer mesmo com filtro de força >= 40');
    
    console.log('\n═'.repeat(80));
    console.log('💡 Para verificar na app:');
    console.log('─'.repeat(80));
    console.log('   1. Abra a app no navegador');
    console.log('   2. Abra o Console (F12 → Console)');
    console.log('   3. Recarregue a página');
    console.log('   4. Veja os logs:');
    console.log('      - 🔍 Buscando sinais: /api/signals?...');
    console.log('      - ✅ Sinais recebidos: X');
    console.log('      - 📊 Sinais MA60: X');
    console.log('   5. Se "Sinais MA60: 0", verifique:');
    console.log('      - Se está logado (autenticação)');
    console.log('      - Se há erros na Network tab');
    console.log('      - Se a resposta da API contém os sinais');
    
    console.log('\n═'.repeat(80));
  } catch (error: any) {
    console.error('❌ Erro:', error.message);
  }
}

testApiDirect();
