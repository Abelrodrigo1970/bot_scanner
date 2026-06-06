import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runAllStrategies } from '@/lib/signalEngine';
import { autoExecuteNewSignalsForStrategy } from '@/lib/autoExecuteNewSignals';

/**
 * Cron dedicado: apenas AFASTAMENTO_MEDIO_30M (velas 30m; universo Scanner 1 — acima SMA200 em 1h).
 * Preferir agendar `/api/cron/run-30m` no cron-job.org (agregado 30m).
 */
async function runInBackground(): Promise<void> {
  try {
    const startedAt = new Date(Date.now() - 2 * 60 * 1000);
    const signalsCreated = await runAllStrategies({
      only: ['AFASTAMENTO_MEDIO_30M'],
    });

    const strategy = await prisma.strategy.findFirst({
      where: { name: 'AFASTAMENTO_MEDIO_30M', isActive: true },
    });
    if (strategy && signalsCreated > 0) {
      const executed = await autoExecuteNewSignalsForStrategy({
        strategy,
        startedAt,
        minStrength: 60,
        logPrefix: '[Afastamento-30m BG]',
      });
      if (executed > 0) {
        console.log(`[Afastamento-30m BG] Auto-exec Bybit: ${executed} ordem(ns)`);
      }
    }

    console.log(`[Afastamento-30m BG] Concluído: ${signalsCreated} sinal(is)`);
  } catch (error) {
    console.error('[Afastamento-30m BG] Erro:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    runInBackground();

    return NextResponse.json({
      success: true,
      message: 'AFASTAMENTO_MEDIO_30M iniciado em background',
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Erro no cron afastamento 30m',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
