/**
 * Script para importar dados do backup SQLite para PostgreSQL
 * Conecta ao PostgreSQL do Railway e importa estratégias e sinais
 * Usa uma cópia temporária do backup e Prisma Client com SQLite
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configurar Prisma para SQLite (backup)
const backupFile = process.argv[2] || 'backups/backup-2025-12-22T21-25-59.db';
const backupPath = path.resolve(process.cwd(), backupFile);

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup não encontrado: ${backupPath}`);
  process.exit(1);
}

// Verificar DATABASE_URL do PostgreSQL
// Pode ser passada como argumento ou variável de ambiente
const postgresUrl = process.argv[3] || process.env.DATABASE_URL;
if (!postgresUrl || !postgresUrl.startsWith('postgresql://')) {
  console.error('❌ DATABASE_URL não configurada ou não é PostgreSQL!');
  console.error('\n📋 Uso:');
  console.error('   node scripts/import-backup-to-postgres.js [backup-file] [postgres-url]');
  console.error('\n   Ou configure:');
  console.error('   DATABASE_URL=postgresql://... node scripts/import-backup-to-postgres.js');
  console.error('\n💡 Dica: Copie a DATABASE_URL do Railway (serviço Postgres → Variables)');
  process.exit(1);
}

console.log('🔄 Importando dados do backup para PostgreSQL...\n');
console.log(`📦 Backup: ${path.basename(backupPath)}`);
console.log(`🗄️  PostgreSQL: ${postgresUrl.replace(/:[^:@]+@/, ':****@')}\n`);

// Salvar DATABASE_URL original
const originalDbUrl = process.env.DATABASE_URL;

async function importData() {
  let postgresClient;
  const tempDb = path.resolve(process.cwd(), './temp-import-backup.db');
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const schemaBackup = schemaPath + '.postgres-backup';
  
  try {
    console.log('📊 Preparando leitura do backup SQLite...\n');
    
    // Criar cópia temporária do backup
    fs.copyFileSync(backupPath, tempDb);
    console.log('✅ Backup copiado para arquivo temporário\n');
    
    // Fazer backup do schema PostgreSQL
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    fs.writeFileSync(schemaBackup, schemaContent);
    
    // Mudar schema para SQLite temporariamente
    const sqliteSchema = schemaContent.replace(/provider = "postgresql"/g, 'provider = "sqlite"');
    fs.writeFileSync(schemaPath, sqliteSchema);
    
    console.log('🔄 Gerando Prisma Client para SQLite...');
    try {
      execSync('npx prisma generate', { 
        stdio: 'pipe',
        cwd: process.cwd(),
        env: { ...process.env }
      });
      console.log('✅ Prisma Client gerado\n');
    } catch (genError) {
      console.error('⚠️  Erro ao gerar Prisma Client:', genError.message);
      console.error('💡 Tente fechar outros processos Node.js que possam estar usando o Prisma Client');
      throw genError;
    }
    
    // Ler dados do SQLite
    process.env.DATABASE_URL = `file:${tempDb}`;
    const { PrismaClient: PrismaClientSQLite } = require('@prisma/client');
    const sqliteClient = new PrismaClientSQLite();
    
    const strategies = await sqliteClient.strategy.findMany();
    console.log(`✅ Encontradas ${strategies.length} estratégias no backup`);
    
    const signals = await sqliteClient.signal.findMany({
      orderBy: { generatedAt: 'desc' },
    });
    console.log(`✅ Encontrados ${signals.length} sinais no backup\n`);
    
    await sqliteClient.$disconnect();
    
    // Restaurar schema PostgreSQL
    fs.writeFileSync(schemaPath, schemaContent);
    console.log('🔄 Restaurando Prisma Client para PostgreSQL...');
    execSync('npx prisma generate', { 
      stdio: 'pipe',
      cwd: process.cwd(),
      env: { ...process.env }
    });
    console.log('✅ Prisma Client restaurado\n');
    
    // Limpar arquivo temporário
    if (fs.existsSync(tempDb)) {
      fs.unlinkSync(tempDb);
    }
    if (fs.existsSync(schemaBackup)) {
      fs.unlinkSync(schemaBackup);
    }
    
    // Conectar ao PostgreSQL
    console.log('🔌 Conectando ao PostgreSQL...');
    process.env.DATABASE_URL = postgresUrl;
    const { PrismaClient: PrismaClientPostgres } = require('@prisma/client');
    postgresClient = new PrismaClientPostgres();
    await postgresClient.$connect();
    console.log('✅ Conectado ao PostgreSQL\n');
    
    // Importar estratégias
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
    
    // Importar sinais
    console.log('📥 Importando sinais...');
    let signalsImported = 0;
    let signalsSkipped = 0;
    
    for (const signal of signals) {
      try {
        // Verificar se já existe (por symbol, direction, entryPrice, generatedAt)
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
        
        // Buscar strategyId no PostgreSQL
        const strategy = await postgresClient.strategy.findUnique({
          where: { name: signal.strategyName || 'RSI' },
        });
        
        if (!strategy) {
          console.error(`⚠️  Estratégia não encontrada para sinal ${signal.symbol}, pulando...`);
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
    
    // Verificar resultado final
    const finalCount = await postgresClient.signal.count();
    console.log(`\n📊 Total de sinais no PostgreSQL: ${finalCount}`);
    
    await postgresClient.$disconnect();
    
    // Restaurar DATABASE_URL original
    process.env.DATABASE_URL = originalDbUrl;
    
    console.log('\n✅ Importação concluída com sucesso!');
    
  } catch (error) {
    console.error('\n❌ Erro durante importação:', error);
    
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
        } catch (e) {}
      } catch (e) {}
    }
    
    if (postgresClient) await postgresClient.$disconnect().catch(() => {});
    process.env.DATABASE_URL = originalDbUrl;
    process.exit(1);
  }
}

importData();
