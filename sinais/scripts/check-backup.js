/**
 * Script para verificar o conteúdo de um backup usando Prisma
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const backupFile = process.argv[2] || 'backups/backup-2025-12-22T21-25-59.db';

const backupPath = path.resolve(process.cwd(), backupFile);

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup não encontrado: ${backupPath}`);
  process.exit(1);
}

// Criar uma cópia temporária para verificar
const tempDb = path.resolve(process.cwd(), './temp-check.db');
fs.copyFileSync(backupPath, tempDb);

// Configurar Prisma para usar o banco temporário
process.env.DATABASE_URL = `file:${tempDb}`;

const prisma = new PrismaClient();

async function checkBackup() {
  try {
    console.log(`\n🔍 Verificando backup: ${path.basename(backupPath)}\n`);
    
    const strategies = await prisma.strategy.count();
    const signals = await prisma.signal.count();
    
    console.log(`📊 Estratégias: ${strategies}`);
    console.log(`📊 Sinais: ${signals}\n`);
    
    if (strategies > 0) {
      const strategyList = await prisma.strategy.findMany({
        select: { name: true, displayName: true, isActive: true },
      });
      console.log('📋 Estratégias encontradas:');
      strategyList.forEach((s) => {
        console.log(`   - ${s.name}: ${s.displayName} (${s.isActive ? 'Ativa' : 'Inativa'})`);
      });
      console.log('');
    }
    
    if (signals > 0) {
      const recentSignals = await prisma.signal.findMany({
        take: 10,
        orderBy: { generatedAt: 'desc' },
        select: {
          symbol: true,
          direction: true,
          strength: true,
          generatedAt: true,
          strategyName: true,
        },
      });
      
      console.log(`📋 Últimos ${Math.min(10, signals)} sinais:`);
      recentSignals.forEach((s, i) => {
        const date = new Date(s.generatedAt).toLocaleString('pt-BR');
        console.log(`   ${i + 1}. ${s.symbol} ${s.direction} - Força: ${s.strength} - ${s.strategyName} - ${date}`);
      });
      
      // Estatísticas
      const byDirection = await prisma.signal.groupBy({
        by: ['direction'],
        _count: true,
      });
      
      console.log('\n📈 Estatísticas por direção:');
      byDirection.forEach((d) => {
        console.log(`   ${d.direction}: ${d._count}`);
      });
    } else {
      console.log('⚠️  Nenhum sinal encontrado neste backup.');
      console.log('   O backup pode ter sido feito antes de gerar sinais.');
    }
    
    await prisma.$disconnect();
    
    // Limpar arquivo temporário
    if (fs.existsSync(tempDb)) {
      fs.unlinkSync(tempDb);
    }
    
  } catch (error) {
    console.error('❌ Erro ao verificar backup:', error.message);
    
    // Limpar arquivo temporário mesmo em caso de erro
    if (fs.existsSync(tempDb)) {
      fs.unlinkSync(tempDb);
    }
    
    process.exit(1);
  }
}

checkBackup();

