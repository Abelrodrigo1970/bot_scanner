import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchBybitAboveMa2004hVol } from '@/lib/marketData';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

async function ensureBybitScan4hTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public."BybitAboveMa2004hVol" (
      "id" TEXT NOT NULL,
      "symbol" TEXT NOT NULL,
      "baseAsset" TEXT NOT NULL,
      "turnover4h" DOUBLE PRECISION NOT NULL,
      "lastPrice" DOUBLE PRECISION NOT NULL,
      "ma200" DOUBLE PRECISION NOT NULL,
      "distPriceMa200" DOUBLE PRECISION NOT NULL,
      "rank" INTEGER NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BybitAboveMa2004hVol_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "BybitAboveMa2004hVol_rank_idx"
    ON public."BybitAboveMa2004hVol"("rank");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "BybitAboveMa2004hVol_turnover4h_idx"
    ON public."BybitAboveMa2004hVol"("turnover4h");
  `);
}

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    let ensureError: string | null = null;
    try {
      await ensureBybitScan4hTable();
    } catch (err) {
      ensureError = err instanceof Error ? err.message : String(err);
      console.warn('[bybit-ma200-4h-volume][GET] ensure table falhou:', ensureError);
    }

    let items: Array<{
      id: string;
      symbol: string;
      baseAsset: string;
      turnover4h: number;
      lastPrice: number;
      ma200: number;
      distPriceMa200: number;
      rank: number;
      updatedAt: Date;
    }> = [];
    let readError: string | null = null;
    try {
      items = await prisma.$queryRaw<Array<{
        id: string;
        symbol: string;
        baseAsset: string;
        turnover4h: number;
        lastPrice: number;
        ma200: number;
        distPriceMa200: number;
        rank: number;
        updatedAt: Date;
      }>>`
        SELECT id, symbol, "baseAsset", "turnover4h", "lastPrice", ma200, "distPriceMa200", rank, "updatedAt"
        FROM "BybitAboveMa2004hVol"
        ORDER BY rank ASC
      `;
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
      console.warn('[bybit-ma200-4h-volume][GET] leitura falhou:', readError);
    }

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
      warning: ensureError || readError || null,
    });
  } catch (error: unknown) {
    console.error('Erro ao buscar scan Bybit MA200 4h + Volume1h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao buscar o scan 4h',
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

    try {
      await ensureBybitScan4hTable();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          success: false,
          error: 'Falha ao preparar tabela do scan 4h',
          details: msg,
        },
        { status: 500 }
      );
    }

    const items = await fetchBybitAboveMa2004hVol(300, 2_000_000);

    await prisma.$executeRaw`DELETE FROM "BybitAboveMa2004hVol"`;
    if (items.length > 0) {
      for (const item of items) {
        const id = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "BybitAboveMa2004hVol"
          ("id", "symbol", "baseAsset", "turnover4h", "lastPrice", "ma200", "distPriceMa200", "rank", "updatedAt")
          VALUES
          (${id}, ${item.symbol}, ${item.baseAsset}, ${item.turnover4h}, ${item.lastPrice}, ${item.ma200}, ${item.distPriceMa200}, ${item.rank}, NOW())
        `;
      }
    }

    const saved = await prisma.$queryRaw<Array<{
      id: string;
      symbol: string;
      baseAsset: string;
      turnover4h: number;
      lastPrice: number;
      ma200: number;
      distPriceMa200: number;
      rank: number;
      updatedAt: Date;
    }>>`
      SELECT id, symbol, "baseAsset", "turnover4h", "lastPrice", ma200, "distPriceMa200", rank, "updatedAt"
      FROM "BybitAboveMa2004hVol"
      ORDER BY rank ASC
    `;

    return NextResponse.json({
      success: true,
      items: saved,
      count: saved.length,
      message: 'Scan Bybit MA200 4h + Volume4h(2M) atualizado com sucesso',
    });
  } catch (error: unknown) {
    console.error('Erro ao atualizar scan Bybit MA200 4h + Volume4h(2M):', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao atualizar o scan 4h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
