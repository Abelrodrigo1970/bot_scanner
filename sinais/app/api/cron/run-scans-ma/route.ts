import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  fetchBybitAboveMa200Mc20m,
  fetchMa30Above6Pct,
  fetchMa30Near6PriceBetween,
} from '@/lib/marketData';

/**
 * Cron dedicado para atualizar os scans de médias:
 * - MA30 > 9% MA200 (1h)
 * - MA30 entre −9% e −3% vs MA200 (1h)
 * - Bybit Volume 1h (500k) + MA200 (1h) → `BybitAboveMa200Mc20m`
 *
 * O trabalho pesado corre em background para evitar timeout do cliente/cron HTTP.
 */

/** Evita dois scans completos em paralelo (ex.: cron a disparar em cima do outro). */
let maScansJobPromise: Promise<void> | null = null;

async function runMaScansJob(): Promise<{
  ma30Above6Pct: number;
  ma30BandMinus3ToMinus9: number;
  bybitVolume1hMa200: number;
}> {
  const above6 = await fetchMa30Above6Pct(100);
  await prisma.ma30Above6Pct.deleteMany({});
  if (above6.length > 0) {
    await prisma.ma30Above6Pct.createMany({
      data: above6.map((item) => ({
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

  const nearBand = await fetchMa30Near6PriceBetween(300);
  await prisma.ma30Near6PriceBetween.deleteMany({});
  if (nearBand.length > 0) {
    await prisma.ma30Near6PriceBetween.createMany({
      data: nearBand.map((item) => ({
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

  console.log('[run-scans-ma] Bybit Volume 1h (500k) + MA200 — a calcular (demora vários minutos)…');
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
    ma30Above6Pct: above6.length,
    ma30BandMinus3ToMinus9: nearBand.length,
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
          message:
            'Scans MA / Bybit já em execução em background; aguarda a conclusão antes de voltar a disparar.',
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
          'Scans MA + Bybit Volume 1h (500k)+MA200 arrancaram em background; a BD atualiza quando terminar (vários minutos).',
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
