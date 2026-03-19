/**
 * Script simplificado para importar dados do backup SQLite para PostgreSQL
 * Tenta evitar regenerar Prisma Client quando possível
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backupFile = process.argv[2] || 'backups/backup-2025-12-22T21-25-59.db';
const backupPath = path.resolve(process.cwd(), backupFile);
const postgresUrl = process.argv[3] || process.env.DATABASE_URL;

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup não encontrado: ${backupPath}`);
  process.exit(1);
}

if (!postgresUrl || !postgresUrl.startsWith('postgresql://')) {
  console.error('❌ DATABASE_URL não configurada ou não é PostgreSQL!');
  console.error('\n📋 Uso:');
  console.error('   node scripts/import-backup-simple.js [backup-file] [postgres-url]');
  process.exit(1);
}

console.log('🔄 Importando dados do backup para PostgreSQL...\n');
console.log(`📦 Backup: ${path.basename(backupPath)}`);
console.log(`🗄️  PostgreSQL: ${postgresUrl.replace(/:[^:@]+@/, ':****@')}\n`);

const tempDb = path.resolve(process.cwd(), './temp-import-backup.db');
const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
const schemaBackup = schemaPath + '.postgres-backup';
const originalDbUrl = process.env.DATABASE_URL;

async function importData() {
  let postgresClient;
  
  try {
    // 1. Criar cópia temporária
    fs.copyFileSync(backupPath, tempDb);
    console.log('✅ Backup copiado\n');
    
    // 2. Fazer backup do schema e mudar para SQLite
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    fs.writeFileSync(schemaBackup, schemaContent);
    const sqliteSchema = schemaContent.replace(/provider = "postgresql"/g, 'provider = "sqlite"');
    fs.writeFileSync(schemaPath, sqliteSchema);
    
    // 3. Gerar Prisma Client para SQLite
    console.log('🔄 Gerando Prisma Client para SQLite...');
    try {
      execSync('npx prisma generate', { stdio: 'pipe' });
      console.log('✅ Prisma Client SQLite gerado\n');
    } catch (genError) {
      console.error('❌ Erro ao gerar Prisma Client SQLite:', genError.message);
      console.error('💡 Feche todos os processos Node.js (VS Code, servidor dev, etc.) e tente novamente');
      throw genError;
    }
    
    // 4. Ler dados do SQLite
    process.env.DATABASE_URL = `file:${tempDb}`;
    
    // Limpar cache do require para forçar reload
    const prismaClientPath = require.resolve('@prisma/client');
    delete require.cache[prismaClientPath];
    delete require.cache[prismaClientPath + '/index.js'];
    
    const { PrismaClient: PrismaClientSQLite } = require('@prisma/client');
    const sqliteClient = new PrismaClientSQLite();
    
    const strategies = await sqliteClient.strategy.findMany();
    const signals = await sqliteClient.signal.findMany({ 
      orderBy: { generatedAt: 'desc' } 
    });
    
    console.log(`✅ Encontradas ${strategies.length} estratégias`);
    console.log(`✅ Encontrados ${signals.length} sinais\n`);
    
    await sqliteClient.$disconnect();
    
    // 5. Restaurar schema PostgreSQL
    fs.writeFileSync(schemaPath, schemaContent);
    
    // 6. Tentar regenerar Prisma Client para PostgreSQL
    console.log('🔄 Restaurando Prisma Client para PostgreSQL...');
    try {
      execSync('npx prisma generate', { stdio: 'pipe' });
      console.log('✅ Prisma Client PostgreSQL restaurado\n');
    } catch (genError) {
      const errorMsg = genError.message || '';
      if (errorMsg.includes('EPERM') || errorMsg.includes('operation not permitted')) {
        console.error('❌ Erro de permissão ao regenerar Prisma Client!');
        console.error('💡 Feche TODOS os processos Node.js e tente novamente');
        console.error('   Ou execute este script em um terminal externo (não no VS Code)');
        throw genError;
      } else {
        throw genError;
      }
    }
    
    // 7. Conectar ao PostgreSQL
    console.log('🔌 Conectando ao PostgreSQL...');
    process.env.DATABASE_URL = postgresUrl;
    
    // Limpar cache novamente
    delete require.cache[prismaClientPath];
    delete require.cache[prismaClientPath + '/index.js'];
    
    const { PrismaClient: PrismaClientPostgres } = require('@prisma/client');
    postgresClient = new PrismaClientPostgres();
    await postgresClient.$connect();
    console.log('✅ Conectado ao PostgreSQL\n');
    
    // 8. Importar estratégias
    console.log('📥 Importando estratégias...');
    let strategiesImported = 0;
    for (const strategy of strategies) {
      try {
        await postgresClient.strategy.upsert({
          where: { name: strategy.name },
          update: {
            displayName: strategy.displayName,
            description: strategy.description,
            isActive: strategy.isActive,
            params: strategy.params,
          },
          create: {
            id: strategy.id,
            name: strategy.name,
            displayName: strategy.displayName,
            description: strategy.description,
            isActive: strategy.isActive,
            params: strategy.params,
            createdAt: strategy.createdAt,
            updatedAt: strategy.updatedAt,
          },
        });
        strategiesImported++;
      } catch (error) {
        console.error(`⚠️  Erro ao importar estratégia ${strategy.name}:`, error.message);
      }
    }
    console.log(`✅ ${strategiesImported}/${strategies.length} estratégias importadas\n`);
    
    // 9. Importar sinais
    console.log('📥 Importando sinais...');
    let signalsImported = 0;
    let signalsSkipped = 0;
    
    for (const signal of signals) {
      try {
        const existing = await postgresClient.signal.findFirst({
          where: {
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            generatedAt: signal.generatedAt,
          },
        });
        
        if (existing) {
          signalsSkipped++;
          continue;
        }
        
        const strategy = await postgresClient.strategy.findUnique({
          where: { name: signal.strategyName || 'RSI' },
        });
        
        if (!strategy) {
          signalsSkipped++;
          continue;
        }
        
        await postgresClient.signal.create({
          data: {
            id: signal.id,
            symbol: signal.symbol,
            direction: signal.direction,
            timeframe: signal.timeframe,
            strategyId: strategy.id,
            strategyName: signal.strategyName,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            target1: signal.target1,
            target2: signal.target2,
            target3: signal.target3,
            strength: signal.strength,
            status: signal.status,
            generatedAt: signal.generatedAt,
            lastCheckedAt: signal.lastCheckedAt,
            extraInfo: signal.extraInfo,
            price24h: signal.price24h,
            result24h: signal.result24h,
            status24h: signal.status24h,
          },
        });
        signalsImported++;
        
        if (signalsImported % 10 === 0) {
          console.log(`   ... ${signalsImported} sinais importados`);
        }
      } catch (error) {
        console.error(`⚠️  Erro ao importar sinal ${signal.symbol} ${signal.direction}:`, error.message);
        signalsSkipped++;
      }
    }
    
    console.log(`\n✅ ${signalsImported}/${signals.length} sinais importados`);
    if (signalsSkipped > 0) {
      console.log(`⚠️  ${signalsSkipped} sinais pulados (já existem ou erro)`);
    }
    
    const finalCount = await postgresClient.signal.count();
    console.log(`\n📊 Total de sinais no PostgreSQL: ${finalCount}`);
    
    await postgresClient.$disconnect();
    
    // Limpar arquivos temporários
    if (fs.existsSync(tempDb)) {
      fs.unlinkSync(tempDb);
    }
    if (fs.existsSync(schemaBackup)) {
      fs.unlinkSync(schemaBackup);
    }
    
    process.env.DATABASE_URL = originalDbUrl;
    console.log('\n✅ Importação concluída com sucesso!');
    
  } catch (error) {
    console.error('\n❌ Erro durante importação:', error.message);
    
    // Limpar arquivos temporários em caso de erro
    if (fs.existsSync(tempDb)) {
      try { fs.unlinkSync(tempDb); } catch (e) {}
    }
    if (fs.existsSync(schemaBackup)) {
      try {
        const schemaContent = fs.readFileSync(schemaBackup, 'utf8');
        fs.writeFileSync(schemaPath, schemaContent);
        fs.unlinkSync(schemaBackup);
        // Tentar restaurar Prisma Client
        try {
          execSync('npx prisma generate', { stdio: 'pipe' });
        } catch (e) {
          console.error('⚠️  Não foi possível restaurar Prisma Client automaticamente');
          console.error('   Execute manualmente: npx prisma generate');
        }
      } catch (e) {
        console.error('⚠️  Erro ao restaurar schema');
      }
    }
    
    if (postgresClient) {
      await postgresClient.$disconnect().catch(() => {});
    }
    process.env.DATABASE_URL = originalDbUrl;
    process.exit(1);
  }
}

importData();

