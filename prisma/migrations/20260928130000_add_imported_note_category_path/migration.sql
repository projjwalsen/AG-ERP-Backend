-- Persist the normalized Excel category Path used by imported debit/credit
-- notes. Existing rows remain NULL and continue to use the legacy ledger
-- entry fallback in Trial Balance.
ALTER TABLE "DebitCreditNote"
ADD COLUMN IF NOT EXISTS "categoryPath" TEXT;

CREATE INDEX IF NOT EXISTS "DebitCreditNote_branchId_categoryPath_idx"
ON "DebitCreditNote"("branchId", "categoryPath");

-- Earlier inward-note imports stored the full Path only on Transaction.type.
-- Backfill those unambiguous values so they participate in category totals.
UPDATE "DebitCreditNote" AS note
SET "categoryPath" = transaction."type"
FROM "Transaction" AS transaction
WHERE transaction."debitCreditNoteId" = note.id
  AND note."sourceType" = 'PURCHASE'
  AND note."categoryPath" IS NULL
  AND transaction."type" LIKE '%/%';

-- Outward note rows currently enter through the Journal import flow.
ALTER TABLE "Journal"
ADD COLUMN IF NOT EXISTS "categoryPath" TEXT;
