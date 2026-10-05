import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';
import { runRsi1hLongPipeline } from '@/lib/rsi1hLongStrategy';
import { syncBybitMissingStopLosses } from '@/lib/tradingExecutor';

export const dynamic = 'force-dynamic';

/**
 * Cron / manual: rsi_1h_long — LONG 1h (Scanner 1 + EMA12 cross↑ + RSI azul <40).
 * No run-15m corre só no 1.º quarto de hora (Lisboa). Este endpoint força por defeito (?force=0 para respeitar horário).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    await ensureMissingBuiltinStrategies(prisma);
    const force = request.nextUrl.searchParams.get('force') !== '0';
    const result = await runRsi1hLongPipeline({
      logPrefix: '[run-rsi-1h-long]',
      force,
    });

    let slSync: Awaited<ReturnType<typeof syncBybitMissingStopLosses>> | null = null;
    try {
      slSync = await syncBybitMissingStopLosses();
      console.log(
        `[run-rsi-1h-long] Bybit SL sync: fixed=${slSync.fixed}/${slSync.checked} skipped=${slSync.skipped}` +
          (slSync.missing.length ? ` MISSING=${slSync.missing.join(',')}` : '') +
          (slSync.conditionalOnly.length
            ? ` condOnly=${slSync.conditionalOnly.join(',')}`
            : '')
      );
    } catch (slErr) {
      console.error('[run-rsi-1h-long] Bybit SL sync falhou:', slErr);
    }

    return NextResponse.json({
      success: true,
      result,
      slSync: slSync
        ? {
            checked: slSync.checked,
            fixed: slSync.fixed,
            skipped: slSync.skipped,
            dustClosed: slSync.dustClosed,
            missing: slSync.missing,
            conditionalOnly: slSync.conditionalOnly,
            errors: slSync.errors,
          }
        : null,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[run-rsi-1h-long] Erro:', error);
    return NextResponse.json(
      {
        error: 'Falha ao correr rsi_1h_long',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
