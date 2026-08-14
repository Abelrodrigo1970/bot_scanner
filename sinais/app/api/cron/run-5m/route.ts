import { NextRequest, NextResponse } from 'next/server';
import { runStch15LongPipeline } from '@/lib/stch15LongStrategy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron 5m:
 * - stch15long — Stochastic Top 2 LONG (15m, wait for close)
 * (Scanner 2 Stoch RSI Top 4 5m descontinuada)
 * Corre em foreground (await) para o auto-exec Bybit terminar antes da resposta.
 */

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    console.log('[Run-5m] Iniciando stch15long...');

    const stch15 = await runStch15LongPipeline();

    if (stch15.status === 'skipped') {
      console.log(`[Run-5m] stch15long skipped: ${stch15.reason}`);
    } else {
      console.log(
        `[Run-5m] stch15long -> LONG ${stch15.longCreated}, fechados ${stch15.closed}, exec ${stch15.executed}`
      );
    }

    return NextResponse.json({
      success: true,
      stch15long:
        stch15.status === 'skipped'
          ? { skipped: true, reason: stch15.reason }
          : {
              longCreated: stch15.longCreated,
              closed: stch15.closed,
              executed: stch15.executed,
              longSymbols: stch15.longSymbols,
              closedSymbols: stch15.closedSymbols,
            },
      executedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron 5m:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron 5m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
