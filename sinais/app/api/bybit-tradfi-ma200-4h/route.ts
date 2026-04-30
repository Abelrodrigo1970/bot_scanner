import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchBybitTradfiAboveMa2004h } from '@/lib/marketData';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

async function ensureBybitTradfiScan4hTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public."BybitTradfiAboveMa2004h" (
      "id" TEXT NOT NULL,
      "symbol" TEXT NOT NULL,
      "baseAsset" TEXT NOT NULL,
      "lastPrice" DOUBLE PRECISION NOT NULL,
      "ma200" DOUBLE PRECISION NOT NULL,
      "distPriceMa200" DOUBLE PRECISION NOT NULL,
      "rank" INTEGER NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BybitTradfiAboveMa2004h_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "BybitTradfiAboveMa2004h_rank_idx"
    ON public."BybitTradfiAboveMa2004h"("rank");
  `);
}

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    let ensureError: string | null = null;
    try {
      await ensureBybitTradfiScan4hTable();
    } catch (err) {
      ensureError = err instanceof Error ? err.message : String(err);
      console.warn('[bybit-tradfi-ma200-4h][GET] ensure table falhou:', ensureError);
    }

    let items: Array<{
      id: string;
      symbol: string;
      baseAsset: string;
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
        lastPrice: number;
        ma200: number;
        distPriceMa200: number;
        rank: number;
        updatedAt: Date;
      }>>`
        SELECT id, symbol, "baseAsset", "lastPrice", ma200, "distPriceMa200", rank, "updatedAt"
        FROM "BybitTradfiAboveMa2004h"
        ORDER BY rank ASC
      `;
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
      console.warn('[bybit-tradfi-ma200-4h][GET] leitura falhou:', readError);
    }

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
      warning: ensureError || readError || null,
    });
  } catch (error: unknown) {
    console.error('Erro ao buscar scan Bybit TradFi MA200 4h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao buscar o scan TradFi 4h',
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
      await ensureBybitTradfiScan4hTable();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          success: false,
          error: 'Falha ao preparar tabela do scan TradFi 4h',
          details: msg,
        },
        { status: 500 }
      );
    }

    const items = await fetchBybitTradfiAboveMa2004h(300);

    await prisma.$executeRaw`DELETE FROM "BybitTradfiAboveMa2004h"`;
    if (items.length > 0) {
      for (const item of items) {
        const id = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "BybitTradfiAboveMa2004h"
          ("id", "symbol", "baseAsset", "lastPrice", "ma200", "distPriceMa200", "rank", "updatedAt")
          VALUES
          (${id}, ${item.symbol}, ${item.baseAsset}, ${item.lastPrice}, ${item.ma200}, ${item.distPriceMa200}, ${item.rank}, NOW())
        `;
      }
    }

    const saved = await prisma.$queryRaw<Array<{
      id: string;
      symbol: string;
      baseAsset: string;
      lastPrice: number;
      ma200: number;
      distPriceMa200: number;
      rank: number;
      updatedAt: Date;
    }>>`
      SELECT id, symbol, "baseAsset", "lastPrice", ma200, "distPriceMa200", rank, "updatedAt"
      FROM "BybitTradfiAboveMa2004h"
      ORDER BY rank ASC
    `;

    return NextResponse.json({
      success: true,
      items: saved,
      count: saved.length,
      message: 'Scan Bybit TradFi MA200 4h (sem filtro de volume) atualizado com sucesso',
    });
  } catch (error: unknown) {
    console.error('Erro ao atualizar scan Bybit TradFi MA200 4h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao atualizar o scan TradFi 4h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
