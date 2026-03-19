/**
 * Script para preparar o projeto para deploy no Railway com PostgreSQL
 * Executa antes de fazer commit/deploy
 */

const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');

console.log('🔄 Preparando para deploy no Railway (PostgreSQL)...\n');

try {
  // Ler schema atual
  let schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Verificar se já está em PostgreSQL
  if (schema.includes('provider = "postgresql"')) {
    console.log('✅ Schema já está configurado para PostgreSQL!');
    console.log('   Você pode fazer deploy normalmente.\n');
    process.exit(0);
  }
  
  // Fazer backup
  const backupPath = schemaPath + '.backup';
  fs.copyFileSync(schemaPath, backupPath);
  console.log(`✅ Backup criado: ${path.basename(backupPath)}\n`);
  
  // Alterar para PostgreSQL
  schema = schema.replace(/provider = "sqlite"/g, 'provider = "postgresql"');
  
  // Salvar
  fs.writeFileSync(schemaPath, schema, 'utf8');
  
  console.log('✅ Schema atualizado para PostgreSQL!');
  console.log('\n📋 Próximos passos:');
  console.log('1. npx prisma generate');
  console.log('2. git add prisma/schema.prisma');
  console.log('3. git commit -m "Configurar PostgreSQL para Railway"');
  console.log('4. git push');
  console.log('\n💡 Após o deploy, execute: node scripts/revert-to-sqlite.js');
  console.log('   para voltar a desenvolver localmente com SQLite.\n');
  
} catch (error) {
  console.error('❌ Erro:', error.message);
  process.exit(1);
}

