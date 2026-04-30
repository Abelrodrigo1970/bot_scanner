-- Criar tabela do scan Bybit TradFi (stocks): preço acima da MA200 (4h), sem filtro de volume
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

CREATE INDEX IF NOT EXISTS "BybitTradfiAboveMa2004h_rank_idx"
  ON public."BybitTradfiAboveMa2004h"("rank");
