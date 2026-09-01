import { NextRequest, NextResponse } from 'next/server';
import { runLiquidityPoolsPro15mPipeline } from '@/lib/liquidityPoolsPro15mStrategy';
import { prisma } from '@/lib/db';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Backup manual: Liquidity Pools Pro 15m (Scanner 2 top 15). */

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    await ensureMissingBuiltinStrategies(prisma);

    const result = await runLiquidityPoolsPro15mPipeline({
      logPrefix: '[cron liquidity-pools]',
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
      signalsCreated: result.signalsCreated,
      executed: result.executed,
      timedClosed: result.timedClosed,
      symbols: result.symbols,
    });
  } catch (error) {
    console.error('Erro liquidity-pools:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar Liquidity Pools 15m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
