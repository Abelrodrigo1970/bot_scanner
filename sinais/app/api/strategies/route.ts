import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Listagem pública - necessário para o dropdown de filtros no dashboard
    const strategies = await prisma.strategy.findMany({
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ strategies });
  } catch (error) {
    console.error('Erro ao buscar estratégias:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar estratégias' },
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
    const { id, isActive, params } = body;

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
    if (params) {
      updateData.params = JSON.stringify(params);
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

