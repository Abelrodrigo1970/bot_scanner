import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { updateMissingHighLow24h } from '@/lib/update24hResults';

/**
 * Endpoint para atualizar high24h e low24h de sinais já fechados
 * Pode ser chamado manualmente para preencher dados históricos
 * Processa em lotes até preencher todos os sinais
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const maxIterations = parseInt(searchParams.get('maxIterations') || '10');
    const batchSize = parseInt(searchParams.get('batchSize') || '500');

    let totalUpdated = 0;
    let totalErrors = 0;
    let iterations = 0;

    // Processar em loop até não haver mais sinais
    while (iterations < maxIterations) {
      iterations++;
      const result = await updateMissingHighLow24h();
      totalUpdated += result.updated;
      totalErrors += result.errors;

      // Se não atualizou nenhum, significa que terminou
      if (result.updated === 0) {
        break;
      }

      // Pequeno delay entre lotes
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return NextResponse.json({
      success: true,
      updated: totalUpdated,
      errors: totalErrors,
      iterations,
      message: `${totalUpdated} sinal(is) atualizado(s) com high24h/low24h em ${iterations} lote(s)`,
    });
  } catch (error) {
    console.error('Erro ao atualizar high24h/low24h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar high24h/low24h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

/**
 * GET também funciona para facilitar chamadas
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const maxIterations = parseInt(searchParams.get('maxIterations') || '10');

    let totalUpdated = 0;
    let totalErrors = 0;
    let iterations = 0;

    // Processar em loop até não haver mais sinais
    while (iterations < maxIterations) {
      iterations++;
      const result = await updateMissingHighLow24h();
      totalUpdated += result.updated;
      totalErrors += result.errors;

      // Se não atualizou nenhum, significa que terminou
      if (result.updated === 0) {
        break;
      }

      // Pequeno delay entre lotes
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return NextResponse.json({
      success: true,
      updated: totalUpdated,
      errors: totalErrors,
      iterations,
      message: `${totalUpdated} sinal(is) atualizado(s) com high24h/low24h em ${iterations} lote(s)`,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao atualizar high24h/low24h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar high24h/low24h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

