import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST: cria a tabela Ma30Near6PriceBetween se ainda não existir (Postgres em produção).
 * Usa a mesma DATABASE_URL da app — após deploy, com sessão iniciada, chama:
 *   fetch('/api/admin/ensure-ma30-near-table', { method: 'POST' })
 */
export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS public."Ma30Near6PriceBetween" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "lastPrice" DOUBLE PRECISION NOT NULL,
    "ma30" DOUBLE PRECISION NOT NULL,
    "ma200" DOUBLE PRECISION NOT NULL,
    "distPriceMa200" DOUBLE PRECISION NOT NULL,
    "distMa30Ma200" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ma30Near6PriceBetween_pkey" PRIMARY KEY ("id")
);
`);

    await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "Ma30Near6PriceBetween_rank_idx" ON public."Ma30Near6PriceBetween"("rank");
`);

    return NextResponse.json({
      success: true,
      message: 'Tabela "Ma30Near6PriceBetween" verificada/criada. Podes actualizar a página da BD e usar o scan.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('ensure-ma30-near-table:', error);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
