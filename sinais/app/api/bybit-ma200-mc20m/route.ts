import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchBybitAboveMa200Mc20m } from '@/lib/marketData';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await prisma.$queryRaw<Array<{
      id: string;
      symbol: string;
      baseAsset: string;
      marketCap: number;
      lastPrice: number;
      ma200: number;
      distPriceMa200: number;
      rank: number;
      updatedAt: Date;
    }>>`
      SELECT id, symbol, "baseAsset", "marketCap", "lastPrice", ma200, "distPriceMa200", rank, "updatedAt"
      FROM "BybitAboveMa200Mc20m"
      ORDER BY rank ASC
    `;

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
    });
  } catch (error: unknown) {
    console.error('Erro ao buscar scan Bybit MA200 + MC20M:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao buscar o scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const items = await fetchBybitAboveMa200Mc20m(300, 20_000_000);

    await prisma.$executeRaw`DELETE FROM "BybitAboveMa200Mc20m"`;
    if (items.length > 0) {
      for (const item of items) {
        const id = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "BybitAboveMa200Mc20m"
          ("id", "symbol", "baseAsset", "marketCap", "lastPrice", "ma200", "distPriceMa200", "rank", "updatedAt")
          VALUES
          (${id}, ${item.symbol}, ${item.baseAsset}, ${item.marketCap}, ${item.lastPrice}, ${item.ma200}, ${item.distPriceMa200}, ${item.rank}, NOW())
        `;
      }
    }

    const saved = await prisma.$queryRaw<Array<{
      id: string;
      symbol: string;
      baseAsset: string;
      marketCap: number;
      lastPrice: number;
      ma200: number;
      distPriceMa200: number;
      rank: number;
      updatedAt: Date;
    }>>`
      SELECT id, symbol, "baseAsset", "marketCap", "lastPrice", ma200, "distPriceMa200", rank, "updatedAt"
      FROM "BybitAboveMa200Mc20m"
      ORDER BY rank ASC
    `;

    return NextResponse.json({
      success: true,
      items: saved,
      count: saved.length,
      message: 'Scan Bybit MA200 + MC20M atualizado com sucesso',
    });
  } catch (error: unknown) {
    console.error('Erro ao atualizar scan Bybit MA200 + MC20M:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao atualizar o scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
