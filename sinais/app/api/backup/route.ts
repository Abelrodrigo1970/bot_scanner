import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

/**
 * Endpoint para fazer backup do banco de dados
 * GET: Lista backups disponíveis
 * POST: Cria um novo backup
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const backupDir = path.resolve(process.cwd(), './backups');
    
    if (!fs.existsSync(backupDir)) {
      return NextResponse.json({
        backups: [],
        message: 'Nenhum backup encontrado',
      });
    }

    const backups = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
      .map((file) => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          size: stats.size,
          sizeKB: (stats.size / 1024).toFixed(2),
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      backups,
      total: backups.length,
    });
  } catch (error) {
    console.error('Erro ao listar backups:', error);
    return NextResponse.json(
      {
        error: 'Erro ao listar backups',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/sinais-vol-rsi.db';
    const dbFile = path.resolve(process.cwd(), dbPath);
    const backupDir = path.resolve(process.cwd(), './backups');

    // Verificar se o banco existe
    if (!fs.existsSync(dbFile)) {
      return NextResponse.json(
        { error: 'Banco de dados não encontrado' },
        { status: 404 }
      );
    }

    // Criar diretório de backups se não existir
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Criar backup com timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFileName = `backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupFileName);

    // Copiar arquivo
    fs.copyFileSync(dbFile, backupPath);

    // Verificar se a cópia foi bem-sucedida
    const originalSize = fs.statSync(dbFile).size;
    const backupSize = fs.statSync(backupPath).size;

    if (originalSize !== backupSize || originalSize === 0) {
      return NextResponse.json(
        { error: 'Backup pode estar corrompido' },
        { status: 500 }
      );
    }

    const stats = fs.statSync(backupPath);

    return NextResponse.json({
      success: true,
      message: 'Backup criado com sucesso',
      backup: {
        filename: backupFileName,
        size: backupSize,
        sizeKB: (backupSize / 1024).toFixed(2),
        createdAt: stats.birthtime.toISOString(),
      },
    });
  } catch (error) {
    console.error('Erro ao criar backup:', error);
    return NextResponse.json(
      {
        error: 'Erro ao criar backup',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

