/**
 * Script inteligente para configurar banco de dados
 * Detecta automaticamente se é SQLite ou PostgreSQL e configura adequadamente
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Resolver referências do Railway (ex: ${{Postgres.DATABASE_URL}})
let databaseUrl = (process.env.DATABASE_URL || '').trim();

// Se for uma referência do Railway que não foi resolvida, tentar outras variáveis
if (databaseUrl.includes('{{') || databaseUrl === '') {
  databaseUrl = (
    process.env.POSTGRES_URL ||
    process.env.RAILWAY_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ''
  ).trim();
}

function detectDbType(url) {
  const u = (url || '').trim();
  const isPostgreSQL =
    u.startsWith('postgresql://') ||
    u.startsWith('postgres://') ||
    u.includes('railway.internal');
  const isSQLite = u.startsWith('file:') || u === '';
  return { isPostgreSQL, isSQLite };
}

let { isPostgreSQL, isSQLite } = detectDbType(databaseUrl);

// Verificar conflito: schema PostgreSQL mas DATABASE_URL SQLite
const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
let schemaProvider = 'unknown';
try {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  if (schemaContent.includes('provider = "postgresql"')) {
    schemaProvider = 'postgresql';
  } else if (schemaContent.includes('provider = "sqlite"')) {
    schemaProvider = 'sqlite';
  }
} catch (e) {
  // Ignorar erro de leitura
}

/** Build Railway/CI sem DATABASE_URL ainda ligado — só gera o client. */
function generatePrismaClientOnly(reason) {
  console.log(`⚠️  ${reason}`);
  console.log('   Gerando Prisma Client; schema aplicado no arranque (db-init).\n');
  execSync('npx prisma generate', {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  });
  console.log('✅ Prisma Client gerado!\n');
  process.exit(0);
}

console.log('🔍 Configurando banco de dados...');
console.log(`   DATABASE_URL: ${databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':****@') : 'não configurado'}`);
console.log(`   DATABASE_URL length: ${databaseUrl.length}`);
console.log(`   isPostgreSQL: ${isPostgreSQL}, isSQLite: ${isSQLite}\n`);

if (databaseUrl.includes('{{')) {
  generatePrismaClientOnly(
    'Referência DATABASE_URL não resolvida — use o botão "Add reference" no Railway (${{Postgres.DATABASE_URL}}).'
  );
}

if (!databaseUrl) {
  if (schemaProvider === 'postgresql') {
    generatePrismaClientOnly(
      'DATABASE_URL não configurado (adicione Postgres no Railway: DATABASE_URL=${{Postgres.DATABASE_URL}}).'
    );
  }
  databaseUrl = 'file:./data/sinais-vol-rsi.db';
  process.env.DATABASE_URL = databaseUrl;
  ({ isPostgreSQL, isSQLite } = detectDbType(databaseUrl));
}

// Build Railway: postgres.railway.internal não responde durante o build
if (schemaProvider === 'postgresql' && isPostgreSQL && databaseUrl.includes('railway.internal')) {
  generatePrismaClientOnly(
    'PostgreSQL railway.internal — build continua; schema aplicado no arranque (db-init).'
  );
}

// Verificar conflitos e corrigir automaticamente ANTES de qualquer operação
let schemaChanged = false;

if (schemaProvider === 'postgresql' && !isPostgreSQL) {
  // Schema PostgreSQL mas URL SQLite — só em dev local (file:)
  if (isSQLite && databaseUrl.startsWith('file:')) {
    console.log('⚠️  Schema está em PostgreSQL mas DATABASE_URL é SQLite.');
    console.log('   Alterando schema para SQLite (desenvolvimento local)...\n');
    try {
      let schemaContent = fs.readFileSync(schemaPath, 'utf8');
      schemaContent = schemaContent.replace(/provider = "postgresql"/g, 'provider = "sqlite"');
      fs.writeFileSync(schemaPath, schemaContent, 'utf8');
      console.log('✅ Schema alterado para SQLite!');
      schemaProvider = 'sqlite';
      schemaChanged = true;
    } catch (error) {
      console.error('❌ Erro ao alterar schema:', error.message);
      process.exit(1);
    }
  } else {
    generatePrismaClientOnly(
      'Schema PostgreSQL mas DATABASE_URL não reconhecida. No Railway: bot_scanner → Variables → DATABASE_URL = reference Postgres.DATABASE_URL'
    );
  }
}

// Se detectar PostgreSQL mas schema está em SQLite, alterar
if (isPostgreSQL && schemaProvider === 'sqlite') {
  console.log('🔄 Schema está em SQLite, alterando para PostgreSQL...\n');
  try {
    let schemaContent = fs.readFileSync(schemaPath, 'utf8');
    schemaContent = schemaContent.replace(/provider = "sqlite"/g, 'provider = "postgresql"');
    fs.writeFileSync(schemaPath, schemaContent, 'utf8');
    console.log('✅ Schema alterado para PostgreSQL!');
    schemaProvider = 'postgresql';
    schemaChanged = true;
  } catch (error) {
    console.error('❌ Erro ao alterar schema:', error.message);
    process.exit(1);
  }
}

// Sempre regenerar Prisma Client para garantir que está sincronizado com o schema
// (importante porque o prisma generate pode ter sido executado antes com schema errado)
console.log('🔄 Gerando Prisma Client (garantindo sincronização com schema)...\n');
try {
  execSync('npx prisma generate', { 
    stdio: 'inherit', 
    cwd: process.cwd(),
    env: { ...process.env }
  });
  console.log('✅ Prisma Client gerado!\n');
} catch (error) {
  console.error('❌ Erro ao gerar Prisma Client:', error.message);
  process.exit(1);
}

if (isPostgreSQL) {
  console.log('✅ Detectado: PostgreSQL');
  
  // Se for railway.internal, não tentar conectar durante o build (só funciona em runtime)
  if (databaseUrl.includes('railway.internal')) {
    console.log('⚠️  PostgreSQL com railway.internal detectado.');
    console.log('   Durante o build, railway.internal não está acessível.');
    console.log('   O schema será aplicado automaticamente quando o serviço iniciar.\n');
    console.log('✅ Continuando build... (schema será aplicado no startup via db-init.ts)\n');
    process.exit(0);
  }
  
  // Verificar se há migrações
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  const hasMigrations = fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).length > 0;
  
  if (hasMigrations) {
    console.log('🔄 Executando migrações...\n');
    try {
      execSync('npx prisma migrate deploy', { 
        stdio: 'inherit', 
        cwd: process.cwd(),
        env: { ...process.env }
      });
      console.log('\n✅ Migrações PostgreSQL concluídas!');
    } catch (error) {
      console.error('\n❌ Erro ao executar migrações PostgreSQL:', error.message);
      // Tentar db push como fallback (SEM --accept-data-loss para preservar dados)
      console.log('⚠️  Tentando db push como fallback (preservando dados)...\n');
      try {
        // NUNCA usar --accept-data-loss no PostgreSQL
        execSync('npx prisma db push', { 
          stdio: 'inherit', 
          cwd: process.cwd(),
          env: { ...process.env },
          timeout: 30000
        });
        console.log('\n✅ Schema aplicado com db push!');
        console.log('✅ DADOS PRESERVADOS!');
      } catch (pushError) {
        // Durante o build, pode não conseguir conectar
        const errorMsg = ((pushError.message || pushError.toString() || '') + ' ' + (pushError.stderr?.toString() || '')).toLowerCase();
        const isConnectionError = errorMsg.includes("can't reach database server") || 
                                  errorMsg.includes('p1001') ||
                                  errorMsg.includes('connection') ||
                                  errorMsg.includes('timeout') ||
                                  errorMsg.includes('railway.internal') ||
                                  errorMsg.includes('econnrefused');
        
        if (isConnectionError) {
          console.log('\n⚠️  Não foi possível conectar ao PostgreSQL durante o build.');
          console.log('   O schema será aplicado automaticamente quando o serviço iniciar.\n');
          console.log('✅ Continuando build... (schema será aplicado no startup via db-init.ts)\n');
          process.exit(0);
        } else {
          console.warn('\n⚠️  db push (fallback) falhou durante o build. Schema será aplicado no arranque.');
          console.log('✅ Continuando build...\n');
          process.exit(0);
        }
      }
    }
  } else {
    console.log('⚠️  Nenhuma migração encontrada. Usando db push (SEM --accept-data-loss para preservar dados)...\n');
    try {
      // NUNCA usar --accept-data-loss no PostgreSQL - dados sempre persistem
      // Capturar stderr para detectar erros de conexão
      let stderrOutput = '';
      try {
        execSync('npx prisma db push', { 
          stdio: ['inherit', 'inherit', 'pipe'], 
          cwd: process.cwd(),
          env: { ...process.env },
          timeout: 10000 // 10 segundos timeout (rápido para não travar build)
        });
        console.log('\n✅ Schema PostgreSQL aplicado com db push!');
        console.log('✅ DADOS PRESERVADOS - PostgreSQL sempre mantém dados entre deploys!');
      } catch (execError) {
        // Capturar stderr se disponível
        if (execError.stderr) {
          stderrOutput = execError.stderr.toString();
        }
        throw execError;
      }
    } catch (pushError) {
      // Durante o build, pode não conseguir conectar (postgres.railway.internal só funciona em runtime)
      const errorMsg = ((pushError.message || pushError.toString() || '') + ' ' + (pushError.stderr?.toString() || '')).toLowerCase();
      const isConnectionError = errorMsg.includes("can't reach database server") || 
                                errorMsg.includes('p1001') ||
                                errorMsg.includes('connection') ||
                                errorMsg.includes('timeout') ||
                                errorMsg.includes('railway.internal') ||
                                errorMsg.includes('econnrefused');
      
      if (isConnectionError) {
        console.log('\n⚠️  Não foi possível conectar ao PostgreSQL durante o build.');
        console.log('   Isso é normal - postgres.railway.internal só funciona quando o serviço está rodando.');
        console.log('   O schema será aplicado automaticamente quando o serviço iniciar.\n');
        console.log('✅ Continuando build... (schema será aplicado no startup via db-init.ts)\n');
        process.exit(0);
      } else {
        // Em CI/Railway o build não deve falhar por db push (schema aplicado no startup)
        console.warn('\n⚠️  db push falhou durante o build:', (pushError.message || pushError).toString().slice(0, 200));
        console.warn('   O schema será aplicado no arranque da aplicação (db-init.ts).');
        console.log('✅ Continuando build...\n');
        process.exit(0);
      }
    }
  }
} else if (isSQLite) {
  console.log('✅ Detectado: SQLite');
  
  const dbPath = databaseUrl.replace('file:', '') || './data/sinais-vol-rsi.db';
  const dbFile = path.resolve(process.cwd(), dbPath);
  const dbDir = path.dirname(dbFile);
  
  // Criar diretório se não existir
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`✅ Diretório ${dbDir} criado`);
  }
  
  // Verificar se o banco já existe
  if (fs.existsSync(dbFile)) {
    console.log('✅ Banco de dados SQLite já existe. Pulando db push para preservar dados.');
    console.log('   Se precisar atualizar o schema, use: npx prisma migrate dev\n');
    process.exit(0);
  }
  
  // Banco não existe, criar com db push
  console.log('⚠️  Banco de dados SQLite não existe. Criando...\n');
  try {
    execSync('npx prisma db push', { 
      stdio: 'inherit', 
      cwd: process.cwd(),
      env: { ...process.env }
    });
    console.log('\n✅ Banco de dados SQLite criado com sucesso!');
  } catch (error) {
    console.error('\n❌ Erro ao criar banco SQLite:', error.message);
    process.exit(1);
  }
} else {
  console.error('❌ DATABASE_URL não reconhecido ou não configurado!');
  console.error(`   Valor recebido: ${databaseUrl || '(vazio)'}`);
  console.error('   Deve ser:');
  console.error('   - PostgreSQL: postgresql://... ou postgres://...');
  console.error('   - SQLite: file:./path/to/db.db');
  console.error('\n⚠️  PROBLEMA: A variável DATABASE_URL não está configurada corretamente no Railway!');
  console.error('   Verifique:');
  console.error('   1. Se PostgreSQL está Online');
  console.error('   2. Se DATABASE_URL está no SERVIÇO (não apenas Shared Variables)');
  console.error('   3. Se DATABASE_URL = ${{Postgres.DATABASE_URL}}');
  process.exit(1);
}

