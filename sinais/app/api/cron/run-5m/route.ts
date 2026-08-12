import { NextRequest, NextResponse } from 'next/server';
import { runScanner2StochRsi5mPipeline } from '@/lib/scanner2StochRsi5mStrategy';
import { runStch15LongPipeline } from '@/lib/stch15LongStrategy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron 5m:
 * - Scanner 2 Stoch RSI Top 4 (5m)
 * - stch15long — Stochastic Top 2 LONG (15m, wait for close)
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
    console.log('[Run-5m] Iniciando Stoch RSI 5m + stch15long...');

    const stochRsi = await runScanner2StochRsi5mPipeline();
    const stch15 = await runStch15LongPipeline();

    if (stochRsi.status === 'skipped') {
      console.log(`[Run-5m] Stoch RSI skipped: ${stochRsi.reason}`);
    } else {
      console.log(
        `[Run-5m] Stoch RSI -> LONG ${stochRsi.longCreated}, SHORT ${stochRsi.shortCreated}, fechados ${stochRsi.closed}, exec ${stochRsi.executed}`
      );
    }

    if (stch15.status === 'skipped') {
      console.log(`[Run-5m] stch15long skipped: ${stch15.reason}`);
    } else {
      console.log(
        `[Run-5m] stch15long -> LONG ${stch15.longCreated}, fechados ${stch15.closed}, exec ${stch15.executed}`
      );
    }

    return NextResponse.json({
      success: true,
      stochRsi5m:
        stochRsi.status === 'skipped'
          ? { skipped: true, reason: stochRsi.reason }
          : {
              longCreated: stochRsi.longCreated,
              shortCreated: stochRsi.shortCreated,
              closed: stochRsi.closed,
              executed: stochRsi.executed,
              longSymbols: stochRsi.longSymbols,
              shortSymbols: stochRsi.shortSymbols,
              closedSymbols: stochRsi.closedSymbols,
            },
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
