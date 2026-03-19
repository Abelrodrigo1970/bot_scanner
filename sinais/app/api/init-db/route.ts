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

    // Verificar/criar diretório
    const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/sinais-vol-rsi.db';
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      results.push(`✅ Diretório ${dbDir} criado`);
    } else {
      results.push(`✅ Diretório ${dbDir} já existe`);
    }

    // Gerar Prisma Client
    try {
      execSync('npx prisma generate', { stdio: 'pipe' });
      results.push('✅ Prisma Client gerado');
    } catch (error: any) {
      results.push(`⚠️ Erro ao gerar Prisma Client: ${error.message}`);
    }

    // Criar banco e tabelas
    try {
      execSync('npx prisma db push --accept-data-loss', { stdio: 'pipe' });
      results.push('✅ Banco de dados e tabelas criados');
    } catch (error: any) {
      results.push(`❌ Erro ao criar banco: ${error.message}`);
      return NextResponse.json(
        { error: 'Erro ao inicializar banco', details: results },
        { status: 500 }
      );
    }

    // Popular estratégias
    try {
      execSync('npx tsx prisma/seed.ts', { stdio: 'pipe' });
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






