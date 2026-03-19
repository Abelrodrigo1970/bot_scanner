/**
 * Script para importar dados do backup SQLite para PostgreSQL
 * Versão 2: Salva dados em JSON e importa sem regenerar Prisma Client
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
  process.exit(1);
}

console.log('🔄 Importando dados do backup para PostgreSQL...\n');
console.log(`📦 Backup: ${path.basename(backupPath)}`);
console.log(`🗄️  PostgreSQL: ${postgresUrl.replace(/:[^:@]+@/, ':****@')}\n`);

const tempDb = path.resolve(process.cwd(), './temp-import-backup.db');
const tempJson = path.resolve(process.cwd(), './temp-import-data.json');
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
    execSync('npx prisma generate', { stdio: 'pipe' });
    console.log('✅ Prisma Client SQLite gerado\n');
    
    // 4. Ler dados do SQLite
    process.env.DATABASE_URL = `file:${tempDb}`;
    
    // Limpar cache
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
    
    // 5. Salvar dados em JSON
    console.log('💾 Salvando dados em JSON temporário...');
    const dataToImport = {
      strategies: strategies.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        isActive: s.isActive,
        params: s.params,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      signals: signals.map(s => ({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        timeframe: s.timeframe,
        strategyName: s.strategyName,
        entryPrice: s.entryPrice,
        stopLoss: s.stopLoss,
        target1: s.target1,
        target2: s.target2,
        target3: s.target3,
        strength: s.strength,
        status: s.status,
        generatedAt: s.generatedAt.toISOString(),
        lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
        extraInfo: s.extraInfo,
        price24h: s.price24h,
        result24h: s.result24h,
        status24h: s.status24h,
      })),
    };
    
    fs.writeFileSync(tempJson, JSON.stringify(dataToImport, null, 2));
    console.log('✅ Dados salvos em JSON\n');
    
    // 6. Restaurar schema PostgreSQL (sem regenerar Prisma Client ainda)
    fs.writeFileSync(schemaPath, schemaContent);
    
    // 7. Limpar cache e tentar usar Prisma Client PostgreSQL existente
    console.log('🔌 Conectando ao PostgreSQL...');
    process.env.DATABASE_URL = postgresUrl;
    
    // Limpar cache completamente
    delete require.cache[prismaClientPath];
    delete require.cache[prismaClientPath + '/index.js'];
    
    // Tentar usar Prisma Client existente
    try {
      const { PrismaClient: PrismaClientPostgres } = require('@prisma/client');
      postgresClient = new PrismaClientPostgres();
      await postgresClient.$connect();
      console.log('✅ Conectado ao PostgreSQL (usando Prisma Client existente)\n');
    } catch (connectError) {
      // Se não conseguir conectar, pode ser que o Prisma Client seja para SQLite
      // Nesse caso, precisamos regenerar, mas vamos tentar uma última vez
      console.log('⚠️  Prisma Client não compatível, regenerando...');
      try {
        execSync('npx prisma generate', { stdio: 'pipe' });
        delete require.cache[prismaClientPath];
        delete require.cache[prismaClientPath + '/index.js'];
        const { PrismaClient: PrismaClientPostgres } = require('@prisma/client');
        postgresClient = new PrismaClientPostgres();
        await postgresClient.$connect();
        console.log('✅ Conectado ao PostgreSQL (após regenerar)\n');
      } catch (genError) {
        const errorMsg = genError.message || '';
        if (errorMsg.includes('EPERM') || errorMsg.includes('operation not permitted')) {
          console.error('\n❌ ERRO: Não foi possível regenerar Prisma Client!');
          console.error('💡 SOLUÇÃO:');
          console.error('   1. Feche TODOS os processos Node.js (VS Code, servidor dev, etc.)');
          console.error('   2. Execute este script em um terminal externo (PowerShell ou CMD)');
          console.error('   3. Ou reinicie o computador e tente novamente');
          console.error('\n📋 Os dados já foram lidos e salvos em:');
          console.error(`   ${tempJson}`);
          console.error('\n💡 Você pode importar manualmente depois de regenerar o Prisma Client');
          throw genError;
        } else {
          throw genError;
        }
      }
    }
    
    // 8. Carregar dados do JSON
    const data = JSON.parse(fs.readFileSync(tempJson, 'utf8'));
    
    // 9. Importar estratégias
    console.log('📥 Importando estratégias...');
    let strategiesImported = 0;
    for (const strategy of data.strategies) {
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
            createdAt: new Date(strategy.createdAt),
            updatedAt: new Date(strategy.updatedAt),
          },
        });
        strategiesImported++;
      } catch (error) {
        console.error(`⚠️  Erro ao importar estratégia ${strategy.name}:`, error.message);
      }
    }
    console.log(`✅ ${strategiesImported}/${data.strategies.length} estratégias importadas\n`);
    
    // 10. Importar sinais
    console.log('📥 Importando sinais...');
    let signalsImported = 0;
    let signalsSkipped = 0;
    
    for (const signal of data.signals) {
      try {
        const existing = await postgresClient.signal.findFirst({
          where: {
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            generatedAt: new Date(signal.generatedAt),
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
            generatedAt: new Date(signal.generatedAt),
            lastCheckedAt: signal.lastCheckedAt ? new Date(signal.lastCheckedAt) : null,
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
    
    console.log(`\n✅ ${signalsImported}/${data.signals.length} sinais importados`);
    if (signalsSkipped > 0) {
      console.log(`⚠️  ${signalsSkipped} sinais pulados (já existem ou erro)`);
    }
    
    const finalCount = await postgresClient.signal.count();
    console.log(`\n📊 Total de sinais no PostgreSQL: ${finalCount}`);
    
    await postgresClient.$disconnect();
    
    // Limpar arquivos temporários
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
    if (fs.existsSync(tempJson)) fs.unlinkSync(tempJson);
    if (fs.existsSync(schemaBackup)) fs.unlinkSync(schemaBackup);
    
    process.env.DATABASE_URL = originalDbUrl;
    console.log('\n✅ Importação concluída com sucesso!');
    
  } catch (error) {
    console.error('\n❌ Erro durante importação:', error.message);
    
    // Limpar arquivos temporários (exceto JSON se houver erro de permissão)
    if (fs.existsSync(tempDb)) {
      try { fs.unlinkSync(tempDb); } catch (e) {}
    }
    
    // Manter JSON se houver erro de permissão para importação manual depois
    if (fs.existsSync(tempJson) && error.message.includes('EPERM')) {
      console.log(`\n💾 Dados salvos em: ${tempJson}`);
      console.log('   Você pode importar manualmente depois de regenerar o Prisma Client');
    } else if (fs.existsSync(tempJson)) {
      fs.unlinkSync(tempJson);
    }
    
    if (fs.existsSync(schemaBackup)) {
      try {
        fs.writeFileSync(schemaPath, fs.readFileSync(schemaBackup, 'utf8'));
        fs.unlinkSync(schemaBackup);
        try {
          execSync('npx prisma generate', { stdio: 'pipe' });
        } catch (e) {
          console.error('⚠️  Execute manualmente: npx prisma generate');
        }
      } catch (e) {}
    }
    
    if (postgresClient) {
      await postgresClient.$disconnect().catch(() => {});
    }
    process.env.DATABASE_URL = originalDbUrl;
    process.exit(1);
  }
}

importData();

