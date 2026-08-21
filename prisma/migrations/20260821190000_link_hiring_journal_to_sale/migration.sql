ALTER TABLE "Journal" ADD COLUMN "saleId" TEXT;

CREATE UNIQUE INDEX "Journal_saleId_key" ON "Journal"("saleId");

ALTER TABLE "Journal" ADD CONSTRAINT "Journal_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
