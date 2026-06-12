import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { runAllStrategies } from '@/lib/signalEngine';

export const maxDuration = 300; // 5 min (Vercel). Railway usa o que tiver configurado.

export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Executa em background (scanners 1/2/4 + estratégias; 1.ª vez pode demorar 10–20 min)
    runAllStrategies()
      .then((n) => console.log(`[Run-Signals] Concluído: ${n} sinais criados`))
      .catch((err) => console.error('[Run-Signals] Erro:', err));

    return NextResponse.json({
      success: true,
      message:
        'Processamento iniciado em background. Se os scanners estiverem vazios, preenche-os primeiro (10–20 min na 1.ª vez). Actualize a página depois.',
    });
  } catch (error) {
    console.error('Erro ao iniciar motor de sinais:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao iniciar geração de sinais',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}




