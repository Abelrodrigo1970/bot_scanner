import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  try {
    // Verificar variáveis de ambiente
    health.checks.env = {
      DATABASE_URL: process.env.DATABASE_URL ? '✅ Configurado' : '❌ Não configurado',
      ACCESS_CODE: process.env.ACCESS_CODE ? '✅ Configurado' : '❌ Não configurado',
      NODE_ENV: process.env.NODE_ENV || 'not set',
    };

    // Verificar banco de dados
    const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/sinais-vol-rsi.db';
    const dbDir = path.dirname(dbPath);
    const dbFile = path.resolve(dbPath);

    health.checks.database = {
      dbPath,
      dbDir,
      dbFile,
      dirExists: fs.existsSync(dbDir) ? '✅' : '❌',
      fileExists: fs.existsSync(dbFile) ? '✅' : '❌',
    };

    // Tentar conectar ao banco
    try {
      const strategyCount = await prisma.strategy.count();
      health.checks.database.connection = '✅ Conectado';
      health.checks.database.strategies = strategyCount;
    } catch (dbError: any) {
      health.checks.database.connection = '❌ Erro de conexão';
      health.checks.database.error = dbError.message;
      health.status = 'error';
    }

    // Verificar se o diretório data/ existe e tem permissão de escrita
    if (!fs.existsSync(dbDir)) {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
        health.checks.database.dirCreated = '✅ Criado agora';
      } catch (mkdirError: any) {
        health.checks.database.dirCreated = `❌ Erro: ${mkdirError.message}`;
        health.status = 'error';
      }
    }

    return NextResponse.json(health, {
      status: health.status === 'ok' ? 200 : 500,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'error',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}






