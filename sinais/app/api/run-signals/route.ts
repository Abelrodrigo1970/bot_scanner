import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { runAllStrategies } from '@/lib/signalEngine';

export async function POST(request: NextRequest) {
  try {
    // Verifica autenticação
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Executa o motor de sinais
    const signalsCreated = await runAllStrategies();

    return NextResponse.json({
      success: true,
      signalsCreated,
      message: `${signalsCreated} novo(s) sinal(is) gerado(s)`,
    });
  } catch (error) {
    console.error('Erro ao executar motor de sinais:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao gerar sinais',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}




