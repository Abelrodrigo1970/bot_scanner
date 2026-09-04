import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';
import { runRsiVendidoPipeline } from '@/lib/rsiVendidoStrategy';

export const dynamic = 'force-dynamic';

/**
 * Cron / manual: rsi_vendido LONG 15m (Scanner 6).
 * Também incluído no pipeline run-15m.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    await ensureMissingBuiltinStrategies(prisma);
    const result = await runRsiVendidoPipeline({ logPrefix: '[run-rsi-vendido]' });

    return NextResponse.json({
      success: true,
      result,
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
