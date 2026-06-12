import '@/lib/trim-env';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import fs from 'fs';
import path from 'path';

function maskDatabaseUrl(url: string): string {
  return url.replace(/:[^:@]+@/, ':****@');
}

export async function GET() {
  const health: Record<string, unknown> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  try {
    const databaseUrl = (process.env.DATABASE_URL || '').trim();
    const isPostgres =
      databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');

    health.checks = {
      env: {
        DATABASE_URL: databaseUrl ? '✅ Configurado' : '❌ Não configurado',
        DATABASE_URL_preview: databaseUrl ? maskDatabaseUrl(databaseUrl) : null,
        ACCESS_CODE: process.env.ACCESS_CODE ? '✅ Configurado' : '❌ Não configurado',
        AUTH_DISABLED: process.env.AUTH_DISABLED === 'true' || !process.env.ACCESS_CODE,
        NODE_ENV: process.env.NODE_ENV || 'not set',
      },
      database: isPostgres
        ? { type: 'postgresql', urlValid: isPostgres ? '✅' : '❌' }
        : (() => {
            const dbPath = databaseUrl.replace('file:', '') || './data/sinais-vol-rsi.db';
            const dbDir = path.dirname(dbPath);
            const dbFile = path.resolve(dbPath);
            return {
              type: 'sqlite',
              dbPath,
              dirExists: fs.existsSync(dbDir) ? '✅' : '❌',
              fileExists: fs.existsSync(dbFile) ? '✅' : '❌',
            };
          })(),
    };

    try {
      const [strategyCount, signalCount, universeScanRuns] = await Promise.all([
        prisma.strategy.count(),
        prisma.signal.count(),
        prisma.universeScanRun.groupBy({
          by: ['universeCode'],
          _max: { scannedAt: true, rowCount: true },
        }),
      ]);
      (health.checks as any).database.connection = '✅ Conectado';
      (health.checks as any).database.strategies = strategyCount;
      (health.checks as any).database.signals = signalCount;
      (health.checks as any).universeScans = Object.fromEntries(
        universeScanRuns.map((r) => [
          r.universeCode,
          {
            rowCount: r._max.rowCount ?? 0,
            scannedAt: r._max.scannedAt?.toISOString() ?? null,
          },
        ])
      );
      (health.checks as any).marketData = {
        primary: process.env.MARKET_DATA_PRIMARY || '(auto)',
        bybitHost: process.env.BYBIT_MARKET_DATA_BASE_URL || '(auto: api.bybit.nl no Railway)',
      };
    } catch (dbError: any) {
      (health.checks as any).database.connection = '❌ Erro de conexão';
      (health.checks as any).database.error = dbError.message;
      health.status = 'error';
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
