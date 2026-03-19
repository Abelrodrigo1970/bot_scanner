/**
 * Script seguro para fazer db push apenas se necessário
 * Não recria o banco se ele já existir, preservando dados
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/sinais-vol-rsi.db';
const dbFile = path.resolve(process.cwd(), dbPath);
const dbDir = path.dirname(dbFile);

// Criar diretório se não existir
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`✅ Diretório ${dbDir} criado`);
}

// Verificar se o banco já existe
if (fs.existsSync(dbFile)) {
  console.log('✅ Banco de dados já existe. Pulando db push para preservar dados.');
  console.log('   Se precisar atualizar o schema, use: npx prisma migrate dev');
  process.exit(0);
}

// Banco não existe, criar com db push
console.log('⚠️ Banco de dados não existe. Criando...');
try {
  execSync('npx prisma db push', { stdio: 'inherit', cwd: process.cwd() });
  console.log('✅ Banco de dados criado com sucesso!');
} catch (error) {
  console.error('❌ Erro ao criar banco:', error.message);
  process.exit(1);
}

