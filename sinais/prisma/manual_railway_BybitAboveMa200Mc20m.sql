-- Criar tabela do scan Bybit: market cap >= 20M e preço acima da MA200 (1h)
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

CREATE INDEX IF NOT EXISTS "BybitAboveMa200Mc20m_rank_idx"
  ON public."BybitAboveMa200Mc20m"("rank");

CREATE INDEX IF NOT EXISTS "BybitAboveMa200Mc20m_marketCap_idx"
  ON public."BybitAboveMa200Mc20m"("marketCap");
