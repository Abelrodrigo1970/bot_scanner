/**
 * Script para garantir que o banco de dados existe
 * Roda no startup da aplicação
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function ensureDatabase() {
  const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/sinais-vol-rsi.db';
  const dbDir = path.dirname(dbPath);
  const dbFile = path.resolve(process.cwd(), dbPath);

  console.log('=== Verificando banco de dados ===');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  console.log('dbPath:', dbPath);
  console.log('dbDir:', dbDir);
  console.log('dbFile:', dbFile);
  console.log('cwd:', process.cwd());

  // Criar diretório se não existir
  if (!fs.existsSync(dbDir)) {
    try {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`✅ Diretório ${dbDir} criado`);
    } catch (error: any) {
      console.error(`❌ Erro ao criar diretório ${dbDir}:`, error.message);
      return false;
    }
  } else {
    console.log(`✅ Diretório ${dbDir} já existe`);
  }

  // Verificar se o banco existe
  if (!fs.existsSync(dbFile)) {
    console.log('⚠️ Banco de dados não existe. Criando...');
    try {
      // Gerar Prisma Client se necessário
      console.log('Gerando Prisma Client...');
      execSync('npx prisma generate', { stdio: 'inherit', cwd: process.cwd() });
      
      // Criar banco e tabelas
      console.log('Criando banco e tabelas...');
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', cwd: process.cwd() });
      
      // Popular estratégias
      console.log('Populando estratégias...');
      try {
        execSync('npx tsx prisma/seed.ts', { stdio: 'inherit', cwd: process.cwd() });
        console.log('✅ Estratégias populadas');
      } catch (e: any) {
        console.log('⚠️ Seed pode ter falhado (normal se já existir):', e.message);
      }
      
      console.log('✅ Banco de dados criado com sucesso!');
      return true;
    } catch (error: any) {
      console.error('❌ Erro ao criar banco de dados:', error.message);
      console.error('Stack:', error.stack);
      return false;
    }
  } else {
    console.log('✅ Banco de dados já existe.');
    return true;
  }
}

// Executar
ensureDatabase()
  .then((success) => {
    if (success) {
      console.log('✅ Inicialização do banco concluída');
      process.exit(0);
    } else {
      console.error('❌ Falha na inicialização do banco');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });

