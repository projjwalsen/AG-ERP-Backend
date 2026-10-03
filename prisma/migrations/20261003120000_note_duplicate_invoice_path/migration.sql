ALTER TABLE "DebitCreditNote"
    ADD COLUMN "sourceInvoiceNo" TEXT;

DROP INDEX IF EXISTS "DebitCreditNote_branchId_agencyId_noteNo_key";

CREATE INDEX IF NOT EXISTS "DebitCreditNote_branchId_noteNo_idx"
    ON "DebitCreditNote"("branchId", "noteNo");
