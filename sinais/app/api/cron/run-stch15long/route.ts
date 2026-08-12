import { NextRequest, NextResponse } from 'next/server';
import { runStch15LongPipeline } from '@/lib/stch15LongStrategy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Backup manual: stch15long (Top 2 Stochastic 15m LONG). */

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const result = await runStch15LongPipeline({
      logPrefix: '[cron stch15long]',
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
      longCreated: result.longCreated,
      closed: result.closed,
      executed: result.executed,
      longSymbols: result.longSymbols,
      closedSymbols: result.closedSymbols,
    });
  } catch (error) {
    console.error('Erro stch15long:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar stch15long',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
