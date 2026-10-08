import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';
import { runRsiQqqPipeline } from '@/lib/rsiQqqStrategy';
import { syncBybitMissingStopLosses } from '@/lib/tradingExecutor';

export const dynamic = 'force-dynamic';

/**
 * Cron / manual: rsi_qqq — top 30 Bybit stocks + QQQUSDT 1h LONG (RSI SMA18 ↑34) + SHORT (EMA20↓EMA70).
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
    const result = await runRsiQqqPipeline({
      logPrefix: '[run-rsi-qqq]',
      force,
    });

    let slSync: Awaited<ReturnType<typeof syncBybitMissingStopLosses>> | null = null;
    try {
      slSync = await syncBybitMissingStopLosses();
      console.log(
        `[run-rsi-qqq] Bybit SL sync: fixed=${slSync.fixed}/${slSync.checked} skipped=${slSync.skipped}` +
          (slSync.missing.length ? ` MISSING=${slSync.missing.join(',')}` : '') +
          (slSync.conditionalOnly.length
            ? ` condOnly=${slSync.conditionalOnly.join(',')}`
            : '')
      );
    } catch (slErr) {
      console.error('[run-rsi-qqq] Bybit SL sync falhou:', slErr);
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
    console.error('[run-rsi-qqq] Erro:', error);
    return NextResponse.json(
      {
        error: 'Falha ao correr rsi_qqq',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
