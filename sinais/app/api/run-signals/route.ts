import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { runAllStrategies } from '@/lib/signalEngine';

export const maxDuration = 300; // 5 min (Vercel). Railway usa o que tiver configurado.

export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Executa em background para evitar timeout (Railway/Vercel ~60–300s)
    runAllStrategies()
      .then((n) => console.log(`[Run-Signals] Concluído: ${n} sinais criados`))
      .catch((err) => console.error('[Run-Signals] Erro:', err));

    return NextResponse.json({
      success: true,
      message: 'Processamento iniciado em background (RSI + Volume). Os sinais aparecem em breve.',
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




