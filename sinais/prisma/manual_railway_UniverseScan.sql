-- Tabelas de histórico dos scanners de universo (Scanner 1/2/3)
CREATE TABLE IF NOT EXISTS public."UniverseScanRun" (
  "id" TEXT NOT NULL,
  "universeCode" TEXT NOT NULL,
  "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rowCount" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  CONSTRAINT "UniverseScanRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UniverseScanRun_universeCode_scannedAt_idx"
  ON public."UniverseScanRun"("universeCode", "scannedAt");

CREATE TABLE IF NOT EXISTS public."UniverseScanRow" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "close" DOUBLE PRECISION NOT NULL,
  "ma" DOUBLE PRECISION NOT NULL,
  "pctFromMa" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "UniverseScanRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UniverseScanRow_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES public."UniverseScanRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UniverseScanRow_runId_idx"
  ON public."UniverseScanRow"("runId");

CREATE INDEX IF NOT EXISTS "UniverseScanRow_symbol_idx"
  ON public."UniverseScanRow"("symbol");
