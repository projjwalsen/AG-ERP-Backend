-- The previous migration created Purchase_invoiceNo_key as a UNIQUE INDEX,
-- not as a table constraint.
DROP INDEX IF EXISTS "Purchase_invoiceNo_key";

CREATE UNIQUE INDEX "Purchase_branchId_agencyId_invoiceNo_key"
ON "Purchase"("branchId", "agencyId", "invoiceNo");
