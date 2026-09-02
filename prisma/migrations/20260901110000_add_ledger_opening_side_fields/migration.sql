-- Preserve debit/credit opening sides instead of storing only a net amount.
ALTER TABLE "Ledger"
    ADD COLUMN IF NOT EXISTS "openingDebit" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "openingCredit" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "openingBalanceDate" TIMESTAMP(3);

-- Existing opening balances belong to the ledger's normal side.
UPDATE "Ledger"
SET
    "openingDebit" = CASE
        WHEN "nature" = 'DEBIT' THEN "openingBalance"
        ELSE "openingDebit"
    END,
    "openingCredit" = CASE
        WHEN "nature" = 'CREDIT' THEN "openingBalance"
        ELSE "openingCredit"
    END
WHERE "openingBalance" <> 0
  AND "openingDebit" = 0
  AND "openingCredit" = 0;
