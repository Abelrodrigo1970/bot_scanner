-- INSTRUÇÕES: Apaga tudo o texto da caixa (o SELECT * FROM AppSetting não cria tabelas).
-- Copia SÓ o bloco entre as linhas de pontas (CREATE ... INDEX ...;), sem o texto deste comentário
-- se o teu editor executar tudo o ficheiro de uma vez.

-- ========== copiar a partir da próxima linha ==========
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

CREATE INDEX IF NOT EXISTS "Ma30Near6PriceBetween_rank_idx" ON public."Ma30Near6PriceBetween"("rank");
-- ========== até aqui ==========

-- Depois, para confirmar: SELECT 1 FROM public."Ma30Near6PriceBetween" LIMIT 1;
