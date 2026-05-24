import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { clearStrategySignals } from '@/lib/strategyMigrations';

/**
 * POST: apaga todos os sinais de uma estratégia (a estratégia mantém-se activa).
 * Body JSON: { "strategyName": "PIVOT_BOSS_BEAR_15M" }
 * Autorização: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    if (!cronSecret) {
      return NextResponse.json(
        { error: 'CRON_SECRET não configurado no servidor — inseguro expor sem segredo' },
        { status: 503 }
      );
    }

    let strategyName = 'PIVOT_BOSS_BEAR_15M';
    try {
      const body = await request.json();
      if (body?.strategyName && typeof body.strategyName === 'string') {
        strategyName = body.strategyName.trim();
      }
    } catch {
      /* body vazio — usa default */
    }

    if (!strategyName) {
      return NextResponse.json({ error: 'strategyName em falta' }, { status: 400 });
    }

    const result = await clearStrategySignals(prisma, strategyName);
    return NextResponse.json({ success: true, result });
  } catch (e) {
    console.error('clear-strategy-signals:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Erro' },
      { status: 500 }
    );
  }
}
