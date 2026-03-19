import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import fs from 'fs';
import path from 'path';

/**
 * Endpoint para importar dados de um backup SQLite para PostgreSQL
 * POST: Importa dados do backup especificado
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const backupFileName = body.backupFile || 'backup-2025-12-22T21-25-59.db';
    const backupPath = path.resolve(process.cwd(), 'backups', backupFileName);

    if (!fs.existsSync(backupPath)) {
      return NextResponse.json(
        { error: `Backup não encontrado: ${backupFileName}` },
        { status: 404 }
      );
    }

    // Verificar se é PostgreSQL
    const databaseUrl = process.env.DATABASE_URL || '';
    if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
      return NextResponse.json(
        { error: 'Este endpoint só funciona com PostgreSQL' },
        { status: 400 }
      );
    }

    // Ler dados do backup usando Prisma com SQLite temporário
    const tempDb = path.resolve(process.cwd(), './temp-import.db');
    fs.copyFileSync(backupPath, tempDb);

    // Mudar DATABASE_URL temporariamente para SQLite
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${tempDb}`;

    // Gerar Prisma Client para SQLite
    const { execSync } = require('child_process');
    execSync('npx prisma generate', { stdio: 'pipe' });

    // Ler dados (precisa recarregar Prisma Client)
    const { PrismaClient: PrismaClientSQLite } = require('@prisma/client');
    const sqliteClient = new PrismaClientSQLite();

    const strategies = await sqliteClient.strategy.findMany();
    const signals = await sqliteClient.signal.findMany({
      orderBy: { generatedAt: 'desc' },
    });

    await sqliteClient.$disconnect();

    // Restaurar DATABASE_URL e Prisma Client
    process.env.DATABASE_URL = originalDbUrl;
    execSync('npx prisma generate', { stdio: 'pipe' });

    // Limpar temp db
    if (fs.existsSync(tempDb)) {
      fs.unlinkSync(tempDb);
    }

    // Importar para PostgreSQL
    let strategiesImported = 0;
    let signalsImported = 0;
    let signalsSkipped = 0;

    // Importar estratégias
    for (const strategy of strategies) {
      try {
        await prisma.strategy.upsert({
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
      } catch (error: any) {
        console.error(`Erro ao importar estratégia ${strategy.name}:`, error.message);
      }
    }

    // Importar sinais
    for (const signal of signals) {
      try {
        // Verificar se já existe
        const existing = await prisma.signal.findFirst({
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

        // Buscar strategyId
        const strategy = await prisma.strategy.findUnique({
          where: { name: signal.strategyName || 'RSI' },
        });

        if (!strategy) {
          signalsSkipped++;
          continue;
        }

        await prisma.signal.create({
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
      } catch (error: any) {
        console.error(`Erro ao importar sinal ${signal.symbol}:`, error.message);
        signalsSkipped++;
      }
    }

    const finalCount = await prisma.signal.count();

    return NextResponse.json({
      success: true,
      message: 'Importação concluída',
      results: {
        strategies: {
          found: strategies.length,
          imported: strategiesImported,
        },
        signals: {
          found: signals.length,
          imported: signalsImported,
          skipped: signalsSkipped,
        },
        totalSignalsInDb: finalCount,
      },
    });
  } catch (error: any) {
    console.error('Erro ao importar backup:', error);
    return NextResponse.json(
      {
        error: 'Erro ao importar backup',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

