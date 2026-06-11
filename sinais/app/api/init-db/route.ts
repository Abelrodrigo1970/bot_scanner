import '@/lib/trim-env';
import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Endpoint para inicializar o banco de dados manualmente
 * Útil para debug e inicialização após deploy
 */
export async function POST() {
  try {
    const results: string[] = [];
    const databaseUrl = (process.env.DATABASE_URL || '').trim();
    const isPostgres =
      databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');

    if (isPostgres) {
      results.push('✅ PostgreSQL detectado');
    } else {
      const dbPath = databaseUrl.replace('file:', '') || './data/sinais-vol-rsi.db';
      const dbDir = path.dirname(dbPath);

      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        results.push(`✅ Diretório ${dbDir} criado`);
      } else {
        results.push(`✅ Diretório ${dbDir} já existe`);
      }
    }

    try {
      execSync('npx prisma generate', { stdio: 'pipe', cwd: process.cwd(), env: { ...process.env } });
      results.push('✅ Prisma Client gerado');
    } catch (error: any) {
      results.push(`⚠️ Erro ao gerar Prisma Client: ${error.message}`);
    }

    try {
      const pushArgs = isPostgres ? [] : ['--accept-data-loss'];
      execSync(`npx prisma db push ${pushArgs.join(' ')}`.trim(), {
        stdio: 'pipe',
        cwd: process.cwd(),
        env: { ...process.env },
        timeout: 60000,
      });
      results.push('✅ Schema aplicado (db push)');
    } catch (error: any) {
      results.push(`❌ Erro ao aplicar schema: ${error.message}`);
      return NextResponse.json(
        { error: 'Erro ao inicializar banco', details: results },
        { status: 500 }
      );
    }

    try {
      execSync('npx tsx prisma/seed.ts', { stdio: 'pipe', cwd: process.cwd(), env: { ...process.env } });
      results.push('✅ Estratégias populadas');
    } catch (error: any) {
      results.push(`⚠️ Seed: ${error.message} (pode ser normal se já existir)`);
    }

    return NextResponse.json({
      success: true,
      message: 'Banco de dados inicializado',
      details: results,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'Erro ao inicializar banco',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
