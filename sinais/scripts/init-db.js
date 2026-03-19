/**
 * Script para inicializar o banco de dados no Railway/produção
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Inicializando banco de dados...');

// Criar diretório se não existir
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('Diretório data/ criado');
}

// Gerar Prisma Client
console.log('Gerando Prisma Client...');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
} catch (error) {
  console.error('Erro ao gerar Prisma Client:', error);
  process.exit(1);
}

// Criar banco de dados e tabelas
console.log('Criando banco de dados e tabelas...');
try {
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
} catch (error) {
  console.error('Erro ao criar banco de dados:', error);
  process.exit(1);
}

// Popular estratégias iniciais
console.log('Populando estratégias iniciais...');
try {
  execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' });
} catch (error) {
  console.error('Erro ao popular estratégias (pode ser normal se já existirem):', error.message);
}

console.log('Banco de dados inicializado com sucesso!');






