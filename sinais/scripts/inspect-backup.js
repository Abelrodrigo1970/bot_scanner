/**
 * Script para inspecionar um backup e ver o que contém
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backupFile = process.argv[2];

if (!backupFile) {
  console.log('Uso: node scripts/inspect-backup.js <arquivo-backup>');
  process.exit(1);
}

const backupPath = path.resolve(process.cwd(), backupFile);

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup não encontrado: ${backupPath}`);
  process.exit(1);
}

console.log(`\n🔍 Inspecionando backup: ${path.basename(backupPath)}`);
console.log(`📁 Caminho: ${backupPath}`);
console.log(`📦 Tamanho: ${(fs.statSync(backupPath).size / 1024).toFixed(2)} KB\n`);

// Tentar usar sqlite3 se disponível
try {
  // Verificar tabelas
  console.log('📊 Tabelas no backup:');
  const tables = execSync(`sqlite3 "${backupPath}" ".tables"`, { encoding: 'utf8' });
  console.log(tables);
  
  // Contar estratégias
  try {
    const strategies = execSync(`sqlite3 "${backupPath}" "SELECT COUNT(*) FROM Strategy;"`, { encoding: 'utf8' });
    console.log(`\n📈 Estratégias: ${strategies.trim()}`);
  } catch (e) {
    console.log('⚠️  Não foi possível contar estratégias (tabela pode não existir)');
  }
  
  // Contar sinais
  try {
    const signals = execSync(`sqlite3 "${backupPath}" "SELECT COUNT(*) FROM Signal;"`, { encoding: 'utf8' });
    console.log(`📈 Sinais: ${signals.trim()}`);
  } catch (e) {
    console.log('⚠️  Não foi possível contar sinais (tabela pode não existir)');
  }
  
  // Mostrar alguns sinais se existirem
  try {
    const sampleSignals = execSync(`sqlite3 "${backupPath}" "SELECT symbol, direction, strength, generatedAt FROM Signal LIMIT 5;"`, { encoding: 'utf8' });
    if (sampleSignals.trim()) {
      console.log('\n📋 Exemplo de sinais:');
      console.log(sampleSignals);
    }
  } catch (e) {
    // Ignorar erro
  }
  
} catch (error) {
  console.log('⚠️  sqlite3 não está disponível. Instalando...');
  console.log('   Você pode instalar com: choco install sqlite ou baixar de https://www.sqlite.org/download.html');
  console.log('\n💡 Alternativa: O backup foi criado com sucesso, mas preciso do sqlite3 para inspecionar.');
}

