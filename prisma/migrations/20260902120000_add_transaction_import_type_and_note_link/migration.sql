ALTER TABLE "Transaction"
    ADD COLUMN "type" TEXT,
    ADD COLUMN "importKey" TEXT,
    ADD COLUMN "debitCreditNoteId" TEXT,
    ADD COLUMN "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "DebitCreditNote"
    ADD COLUMN "importKey" TEXT;

UPDATE "Transaction"
SET "transactionDate" = "createdAt";

-- Backfill only when the linked Purchase already carries an explicit
-- Purchase-account classification. Generic PURCHASE values are intentionally
-- left null because they do not identify the Excel Type head.
UPDATE "Transaction" AS transaction
SET "type" = REPLACE(purchase."voucherType"::text, '_', ' ')
FROM "Purchase" AS purchase
WHERE transaction."purchaseId" = purchase."id"
  AND transaction."type" IS NULL
  AND transaction."remarks" LIKE 'Imported Day Book %'
  AND purchase."voucherType"::text IN (
      'IGST_PURCHASE',
      'GST_PURCHASE',
      'CST_PURCHASE',
      'DISCOUNT_PURCHASE',
      'HIGH_SEAS_PURCHASE',
      'IMPORT_PURCHASE',
      'VAT_PURCHASE',
      'INTEREST_SAUNDRY_CREDITORS'
  );

DROP INDEX IF EXISTS "DebitCreditNote_noteNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_importKey_key"
    ON "Transaction"("importKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_debitCreditNoteId_key"
    ON "Transaction"("debitCreditNoteId");
CREATE INDEX IF NOT EXISTS "Transaction_type_idx"
    ON "Transaction"("type");
CREATE INDEX IF NOT EXISTS "Transaction_transactionDate_idx"
    ON "Transaction"("transactionDate");

CREATE UNIQUE INDEX IF NOT EXISTS "DebitCreditNote_importKey_key"
    ON "DebitCreditNote"("importKey");
CREATE UNIQUE INDEX IF NOT EXISTS "DebitCreditNote_branchId_agencyId_noteNo_key"
    ON "DebitCreditNote"("branchId", "agencyId", "noteNo");

ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_debitCreditNoteId_fkey"
    FOREIGN KEY ("debitCreditNoteId") REFERENCES "DebitCreditNote"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Purchase ledgers are displayed under their own Trial Balance root instead
-- of being mixed into generic Expenses.
INSERT INTO "LedgerGroup" ("id", "code", "name", "nature", "updatedAt")
VALUES (
    '00000000-0000-4000-8000-000000000005',
    'PURCHASE_ACCOUNTS',
    'Purchase Accounts',
    'DEBIT',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "nature" = EXCLUDED."nature",
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "LedgerGroup"
SET
    "parentId" = (
        SELECT "id" FROM "LedgerGroup" WHERE "code" = 'PURCHASE_ACCOUNTS'
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'PURCHASE';
