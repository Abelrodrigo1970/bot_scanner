import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';
import { runRsiVendidoPipeline } from '@/lib/rsiVendidoStrategy';
import { syncBybitMissingStopLosses } from '@/lib/tradingExecutor';

export const dynamic = 'force-dynamic';

/**
 * Cron / manual: rsi_vendido LONG 4h (Scanner 6 + EMA21 +0,8%).
 * No run-15m corre só de 2em2h (Lisboa). Este endpoint força execução (?force=0 para respeitar horário).
 * No fim: verifica todas as posições Bybit abertas e coloca SL Full onde faltar
 * (a Bybit por vezes remove o SL Full da UI — este passo repõe).
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
    const result = await runRsiVendidoPipeline({
      logPrefix: '[run-rsi-vendido]',
      force,
    });

    // Sempre: reaplica SL em posições abertas sem stop (NEAR, AVAX, etc.)
    let slSync: Awaited<ReturnType<typeof syncBybitMissingStopLosses>> | null = null;
    try {
      slSync = await syncBybitMissingStopLosses();
      console.log(
        `[run-rsi-vendido] Bybit SL sync: fixed=${slSync.fixed}/${slSync.checked} skipped=${slSync.skipped}` +
          (slSync.missing.length ? ` MISSING=${slSync.missing.join(',')}` : '') +
          (slSync.conditionalOnly.length
            ? ` condOnly=${slSync.conditionalOnly.join(',')}`
            : '')
      );
    } catch (slErr) {
      console.error('[run-rsi-vendido] Bybit SL sync falhou:', slErr);
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
    console.error('[run-rsi-vendido] Erro:', error);
    return NextResponse.json(
      {
        error: 'Falha ao correr rsi_vendido',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
