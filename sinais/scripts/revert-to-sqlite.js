/**
 * Script para reverter o schema para SQLite (desenvolvimento local)
 * Execute após fazer deploy no Railway
 */

const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');

console.log('🔄 Revertendo schema para SQLite (desenvolvimento local)...\n');

try {
  // Ler schema atual
  let schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Verificar se já está em SQLite
  if (schema.includes('provider = "sqlite"')) {
    console.log('✅ Schema já está configurado para SQLite!');
    process.exit(0);
  }
  
  // Alterar para SQLite
  schema = schema.replace(/provider = "postgresql"/g, 'provider = "sqlite"');
  
  // Salvar
  fs.writeFileSync(schemaPath, schema, 'utf8');
  
  // Regenerar Prisma Client
  console.log('✅ Schema revertido para SQLite!');
  console.log('🔄 Regenerando Prisma Client...\n');
  
  const { execSync } = require('child_process');
  execSync('npx prisma generate', { stdio: 'inherit' });
  
  console.log('\n✅ Pronto! Você pode desenvolver localmente com SQLite agora.\n');
  
} catch (error) {
  console.error('❌ Erro:', error.message);
  process.exit(1);
}

