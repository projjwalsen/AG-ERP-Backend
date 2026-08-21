ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_invoiceNo_key";

CREATE UNIQUE INDEX "Purchase_branchId_agencyId_invoiceNo_key"
ON "Purchase"("branchId", "agencyId", "invoiceNo");
