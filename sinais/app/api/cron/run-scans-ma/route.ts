import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchBybitAboveMa200Mc20m, fetchMaCrossBelow } from '@/lib/marketData';

/**
 * Atualiza tabelas de universo usadas por estratégias activas:
 * - MaCrossBelow → MA_VOLATILE
 * - BybitAboveMa200Mc20m → MA_CROSS_5M, MA_CROSS_1H
 *
 * Scanners 1/2/3 (afastamento / RSI): /api/cron/run-universe-scans
 */
let maScansJobPromise: Promise<void> | null = null;

async function runMaScansJob(): Promise<{
  maCrossBelow: number;
  bybitVolume1hMa200: number;
}> {
  const maCross = await fetchMaCrossBelow(100);
  await prisma.maCrossBelow.deleteMany({});
  if (maCross.length > 0) {
    await prisma.maCrossBelow.createMany({
      data: maCross.map((item) => ({
        symbol: item.symbol,
        lastPrice: item.lastPrice,
        ma30: item.ma30,
        ma200: item.ma200,
        distPriceMa200: item.distPriceMa200,
        distMa30Ma200: item.distMa30Ma200,
        rank: item.rank,
      })),
    });
  }

  console.log('[run-scans-ma] Bybit Volume 1h (500k) + MA200 — a calcular…');
  const bybitVolMa200 = await fetchBybitAboveMa200Mc20m(300, 500_000);
  await prisma.bybitAboveMa200Mc20m.deleteMany({});
  if (bybitVolMa200.length > 0) {
    await prisma.bybitAboveMa200Mc20m.createMany({
      data: bybitVolMa200.map((item) => ({
        symbol: item.symbol,
        baseAsset: item.baseAsset,
        marketCap: item.marketCap,
        lastPrice: item.lastPrice,
        ma200: item.ma200,
        distPriceMa200: item.distPriceMa200,
        rank: item.rank,
      })),
    });
  }

  return {
    maCrossBelow: maCross.length,
    bybitVolume1hMa200: bybitVolMa200.length,
  };
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (maScansJobPromise) {
      return NextResponse.json(
        {
          accepted: false,
          busy: true,
          message: 'Scans MA/Bybit já em execução em background.',
          startedAt: new Date().toISOString(),
        },
        { status: 202 }
      );
    }

    const startedAt = new Date().toISOString();

    maScansJobPromise = (async () => {
      try {
        const counts = await runMaScansJob();
        console.log('[run-scans-ma] concluído', { ...counts, startedAt });
      } catch (err) {
        console.error('[run-scans-ma] erro em background:', err);
      } finally {
        maScansJobPromise = null;
      }
    })();

    return NextResponse.json(
      {
        accepted: true,
        background: true,
        message:
          'Scans MaCrossBelow + Bybit Vol1h/MA200 em background (universos MA_VOLATILE e MA Cross).',
        startedAt,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('Erro no cron de scans MA:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar scans MA',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
