import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { migrateVolumeSpike15mToMaCross5m } from '@/lib/strategyMigrations';

/**
 * POST: executa uma vez a migração VOLUME_SPIKE_15M → MA_CROSS_5M
 * (útil se o seed nunca tiver conseguido correr no deploy).
 * Autorização: Authorization: Bearer <CRON_SECRET> (o mesmo do cron)
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

    const result = await migrateVolumeSpike15mToMaCross5m(prisma);
    return NextResponse.json({ success: true, result });
  } catch (e) {
    console.error('migrate-volume-spike-15m:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Erro' },
      { status: 500 }
    );
  }
}
