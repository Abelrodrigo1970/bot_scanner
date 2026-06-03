import { NextRequest, NextResponse } from 'next/server';
import {
  runEmaRibbonBuy15mPipeline,
  runMaCross15mPipeline,
} from '@/lib/cron15mStrategies';

/**
 * Cron agregado 15m (24h recomendado — MA Cross whitelist filtra horas PT).
 *
 * Ordem de execução (sequencial, mesmo processo) — pedido do utilizador:
 *   1.º  MA Cross 15m (MA12/MA30)  ← prioridade: corre até ao fim primeiro
 *   2.º  EMA Ribbon Scalping BUY 15m (tendência de alta + retração)
 *
 * Correr em sequência (em vez de em paralelo) evita que as duas estratégias
 * compitam pela fila de pedidos à Binance e dá prioridade à MA Cross.
 */
async function run15mInBackground(now: Date): Promise<void> {
  console.log('[Run-15m BG] Iniciando agregado 15m (sequencial: 1º MA Cross 15m, 2º EMA Ribbon BUY)...');

  try {
    const maCross = await runMaCross15mPipeline(now);
    console.log(`[Run-15m BG] 1/2 MA Cross 15m -> ${maCross.status}` +
      (typeof maCross.signalsCreated === 'number' ? ` (${maCross.signalsCreated} sinais)` : ''));
  } catch (error) {
    console.error('[Run-15m BG] MA Cross 15m falhou:', error);
  }

  try {
    const created = await runEmaRibbonBuy15mPipeline();
    console.log(`[Run-15m BG] 2/2 EMA Ribbon BUY 15m -> ${created} sinais`);
  } catch (error) {
    console.error('[Run-15m BG] EMA Ribbon BUY 15m falhou:', error);
  }

  console.log('[Run-15m BG] Agregado 15m finalizado (sequencial).');
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();

    // Resposta imediata; o trabalho pesado corre em background (evita timeout Railway).
    run15mInBackground(now).catch((error) => {
      console.error('[Run-15m BG] Erro fatal:', error);
    });

    return NextResponse.json({
      success: true,
      message: 'Processamento agregado 15m (1º MA Cross 15m, 2º EMA Ribbon BUY) iniciado em background',
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron agregado 15m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
