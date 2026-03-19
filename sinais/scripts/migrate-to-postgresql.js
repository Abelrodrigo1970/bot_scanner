/**
 * Script para migrar de SQLite para PostgreSQL
 * Atualiza o schema.prisma automaticamente
 */

const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');

console.log('🔄 Migrando schema para PostgreSQL...');

try {
  // Ler o schema atual
  let schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Verificar se já está em PostgreSQL
  if (schema.includes('provider = "postgresql"')) {
    console.log('✅ Schema já está configurado para PostgreSQL!');
    process.exit(0);
  }
  
  // Fazer backup do schema original
  const backupPath = schemaPath + '.backup';
  fs.copyFileSync(schemaPath, backupPath);
  console.log(`✅ Backup criado: ${backupPath}`);
  
  // Substituir sqlite por postgresql
  schema = schema.replace(/provider = "sqlite"/g, 'provider = "postgresql"');
  
  // Salvar schema atualizado
  fs.writeFileSync(schemaPath, schema, 'utf8');
  
  console.log('✅ Schema atualizado para PostgreSQL!');
  console.log('');
  console.log('📋 Próximos passos:');
  console.log('1. Adicione PostgreSQL no Railway: "+ New" → "Database" → "PostgreSQL"');
  console.log('2. Execute: npx prisma generate');
  console.log('3. Execute: npx prisma migrate dev --name init');
  console.log('4. Ou para produção: npx prisma migrate deploy');
  console.log('');
  console.log('💡 O Railway configurará automaticamente a DATABASE_URL');
  
} catch (error) {
  console.error('❌ Erro ao migrar schema:', error.message);
  process.exit(1);
}

