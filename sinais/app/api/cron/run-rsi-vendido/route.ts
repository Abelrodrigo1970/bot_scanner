import { NextRequest, NextResponse } from 'next/server';
import { runRsiVendidoPipeline } from '@/lib/rsiVendidoStrategy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Backup manual: rsi_vendido LONG (RSI 4h cruza < 25, sai > 32). */

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const result = await runRsiVendidoPipeline({
      logPrefix: '[cron rsi_vendido]',
    });

    if (result.status === 'skipped') {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: result.reason,
      });
    }

    return NextResponse.json({
      success: true,
      timedClosed: result.timedClosed,
      rsiClosed: result.rsiClosed,
      signalsCreated: result.signalsCreated,
      executed: result.executed,
      symbols: result.symbols,
      closedSymbols: result.closedSymbols,
    });
  } catch (error) {
    console.error('Erro rsi_vendido:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar rsi_vendido',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
