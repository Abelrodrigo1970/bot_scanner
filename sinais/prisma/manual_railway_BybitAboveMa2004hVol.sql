-- Criar tabela do scan Bybit 4h: turnover 4h >= 2M USDT e preço acima da MA200 (4h)
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

CREATE INDEX IF NOT EXISTS "BybitAboveMa2004hVol_rank_idx"
  ON public."BybitAboveMa2004hVol"("rank");

CREATE INDEX IF NOT EXISTS "BybitAboveMa2004hVol_turnover4h_idx"
  ON public."BybitAboveMa2004hVol"("turnover4h");
