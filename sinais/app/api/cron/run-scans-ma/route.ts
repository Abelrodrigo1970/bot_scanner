import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchMa30Above6Pct, fetchMa30Near6PriceBetween } from '@/lib/marketData';

/**
 * Cron dedicado para atualizar os scans de médias:
 * - MA30 > 6% MA200 (1h)
 * - MA30 entre -5% e -10% vs MA200 (1h)
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 1) Scan MA30 > 6% MA200
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

    // 2) Scan MA30 -5% a -10% vs MA200
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

    return NextResponse.json({
      success: true,
      message: 'Scans MA atualizados com sucesso',
      counts: {
        ma30Above6Pct: above6.length,
        ma30Minus5ToMinus10: nearBand.length,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron de scans MA:', error);
    return NextResponse.json(
      {
        error: 'Erro ao atualizar scans MA',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

