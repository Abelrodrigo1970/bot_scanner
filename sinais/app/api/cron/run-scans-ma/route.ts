import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchBybitAboveMa200Mc20m } from '@/lib/marketData';

/**
 * Atualiza tabela BybitAboveMa200Mc20m (menu Origem de dados Bybit).
 *
 * Scanners 1/2/3 (afastamento / RSI): /api/cron/run-universe-scans
 */
let maScansJobPromise: Promise<void> | null = null;

async function runMaScansJob(): Promise<{ bybitVolume1hMa200: number }> {
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
        message: 'Scan Bybit Vol1h/MA200 em background.',
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
