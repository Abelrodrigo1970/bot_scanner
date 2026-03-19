/**
 * Script para verificar dados no banco de dados
 */

// Garantir que DATABASE_URL está configurado ANTES de importar PrismaClient
// Tentar diferentes caminhos
const fs = require('fs');
const path = require('path');

const possiblePaths = [
  'file:./data/sinais-vol-rsi.db',
  'file:./prisma/dev.db',
];

let dbPath = process.env.DATABASE_URL;
if (!dbPath) {
  // Tentar encontrar qual banco existe
  for (const possiblePath of possiblePaths) {
    const dbFile = path.resolve(process.cwd(), possiblePath.replace('file:', ''));
    if (fs.existsSync(dbFile)) {
      dbPath = possiblePath;
      break;
    }
  }
  
  if (!dbPath) {
    dbPath = possiblePaths[0]; // Default
  }
}

process.env.DATABASE_URL = dbPath;
console.log(`Usando banco: ${dbPath}\n`);

// Importar PrismaClient DEPOIS de configurar DATABASE_URL
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    const signals = await prisma.signal.count();
    const strategies = await prisma.strategy.count();
    
    console.log('=== Status do Banco de Dados ===');
    console.log('Estrategias:', strategies);
    console.log('Sinais:', signals);
    
    if (signals > 0) {
      const recentSignals = await prisma.signal.findMany({
        take: 5,
        orderBy: { generatedAt: 'desc' },
        select: {
          symbol: true,
          direction: true,
          generatedAt: true,
          strength: true,
        },
      });
      
      console.log('\nUltimos 5 sinais:');
      recentSignals.forEach((s, i) => {
        console.log(`${i + 1}. ${s.symbol} ${s.direction} - Forca: ${s.strength} - ${s.generatedAt.toLocaleString('pt-BR')}`);
      });
    }
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  }
}

checkDatabase();

