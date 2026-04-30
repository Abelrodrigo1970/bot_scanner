import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchBybitAboveMa200Mc20m } from '@/lib/marketData';
import { randomUUID } from 'crypto';

async function ensureBybitScanTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public."BybitAboveMa200Mc20m" (
      "id" TEXT NOT NULL,
      "symbol" TEXT NOT NULL,
      "baseAsset" TEXT NOT NULL,
      "marketCap" DOUBLE PRECISION NOT NULL,
      "lastPrice" DOUBLE PRECISION NOT NULL,
      "ma200" DOUBLE PRECISION NOT NULL,
      "distPriceMa200" DOUBLE PRECISION NOT NULL,
      "rank" INTEGER NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BybitAboveMa200Mc20m_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "BybitAboveMa200Mc20m_rank_idx"
    ON public."BybitAboveMa200Mc20m"("rank");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "BybitAboveMa200Mc20m_marketCap_idx"
    ON public."BybitAboveMa200Mc20m"("marketCap");
  `);
}

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    await ensureBybitScanTable();

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
    await ensureBybitScanTable();

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
