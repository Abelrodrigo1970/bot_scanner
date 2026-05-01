import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchBybitAboveMa200Mc20m } from '@/lib/marketData';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/** Evita scans sobrepostos e permite responder 202 antes do fim (~minutos de klines Bybit). */
let refreshInFlight = false;

async function runBybitMa200Mc20mRefreshJob(): Promise<void> {
  try {
    console.log('[bybit-ma200-mc20m][BG] Início do scan Bybit MA200 + turnover 1h…');
    const items = await fetchBybitAboveMa200Mc20m(300, 500_000);
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
    console.log(`[bybit-ma200-mc20m][BG] Concluído: ${items.length} linhas gravadas`);
  } catch (e) {
    console.error('[bybit-ma200-mc20m][BG] Falha:', e);
  } finally {
    refreshInFlight = false;
  }
}

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
    let ensureError: string | null = null;
    try {
      await ensureBybitScanTable();
    } catch (err) {
      ensureError = err instanceof Error ? err.message : String(err);
      console.warn('[bybit-ma200-mc20m][GET] ensure table falhou:', ensureError);
    }

    let items: Array<{
      id: string;
      symbol: string;
      baseAsset: string;
      marketCap: number;
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
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
      console.warn('[bybit-ma200-mc20m][GET] leitura falhou:', readError);
    }

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      fetchedAt: items[0]?.updatedAt?.toISOString() ?? null,
      warning: ensureError || readError || null,
    });
  } catch (error: unknown) {
    console.error('Erro ao buscar scan Bybit MA200 + Volume15M:', error);
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
    try {
      await ensureBybitScanTable();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          success: false,
          error: 'Falha ao preparar tabela do scan',
          details: msg,
        },
        { status: 500 }
      );
    }

    if (refreshInFlight) {
      return NextResponse.json(
        {
          success: true,
          accepted: false,
          skipped: true,
          message: 'Já existe uma atualização deste scan em curso; aguarde e volte a carregar a página.',
        },
        { status: 202 }
      );
    }

    refreshInFlight = true;
    void runBybitMa200Mc20mRefreshJob();

    return NextResponse.json(
      {
        success: true,
        accepted: true,
        message:
          'Scan iniciado em segundo plano (demora vários minutos). A página vai atualizar sozinha quando a BD estiver pronta.',
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    console.error('Erro ao atualizar scan Bybit MA200 + Volume1h(500k):', error);
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
