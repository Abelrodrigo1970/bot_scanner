import { NextRequest, NextResponse } from 'next/server';
import { runScanner2StochRsi5mPipeline } from '@/lib/scanner2StochRsi5mStrategy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron 5m: Scanner 2 Stoch RSI Top 4
 * Stoch RSI (50/50/40/11) — K×D up LONG / K×D down fecha.
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
    console.log('[Run-5m] Iniciando Scanner 2 Stoch RSI Top 4...');

    const result = await runScanner2StochRsi5mPipeline();

    if (result.status === 'skipped') {
      console.log(`[Run-5m] Stoch RSI skipped: ${result.reason}`);
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: result.reason,
        executedAt: now.toISOString(),
      });
    }

    console.log(
      `[Run-5m] Stoch RSI -> LONG ${result.longCreated}, fechados ${result.closed}, exec ${result.executed}`
    );

    return NextResponse.json({
      success: true,
      longCreated: result.longCreated,
      closed: result.closed,
      executed: result.executed,
      longSymbols: result.longSymbols,
      closedSymbols: result.closedSymbols,
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
