import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';

export async function GET(request: NextRequest) {
  try {
    // Garantir que o banco está inicializado antes de consultar
    let dbReady = false;
    try {
      dbReady = await ensureDatabase();
    } catch (initErr: any) {
      console.error('ensureDatabase threw:', initErr?.message || initErr);
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Verifique DATABASE_URL. Tente /api/init-db ou /api/health para diagnóstico.',
          details: initErr?.message,
        },
        { status: 503 }
      );
    }
    if (!dbReady) {
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Verifique DATABASE_URL e tente /api/init-db ou aguarde a inicialização automática',
        },
        { status: 503 }
      );
    }

    // Listagem pública - necessário para o dropdown de filtros no dashboard
    const strategies = await prisma.strategy.findMany({
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ strategies });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro ao buscar estratégias:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar estratégias', details: msg },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { id, isActive, params, allowBuy, allowSell } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID da estratégia é obrigatório' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }

    // allowBuy / allowSell podem vir directamente no body ou dentro de params
    if (params || typeof allowBuy === 'boolean' || typeof allowSell === 'boolean') {
      // Se vierem allowBuy/allowSell directamente, mergear com params existentes
      if (typeof allowBuy === 'boolean' || typeof allowSell === 'boolean') {
        const current = await prisma.strategy.findUnique({ where: { id } });
        const currentParams = current?.params ? JSON.parse(current.params) : {};
        const merged = {
          ...currentParams,
          ...(params ?? {}),
          ...(typeof allowBuy  === 'boolean' ? { allowBuy }  : {}),
          ...(typeof allowSell === 'boolean' ? { allowSell } : {}),
        };
        updateData.params = JSON.stringify(merged);
      } else {
        updateData.params = JSON.stringify(params);
      }
    }

    const strategy = await prisma.strategy.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ strategy });
  } catch (error) {
    console.error('Erro ao atualizar estratégia:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar estratégia' },
      { status: 500 }
    );
  }
}

