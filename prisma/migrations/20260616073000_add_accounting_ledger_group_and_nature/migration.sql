-- CreateEnum
CREATE TYPE "LedgerNature" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "LedgerGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "nature" "LedgerNature" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerGroup_code_key" ON "LedgerGroup"("code");
CREATE INDEX "LedgerGroup_parentId_idx" ON "LedgerGroup"("parentId");
CREATE INDEX "LedgerGroup_nature_idx" ON "LedgerGroup"("nature");

-- AddForeignKey
ALTER TABLE "LedgerGroup"
ADD CONSTRAINT "LedgerGroup_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "LedgerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Root groups.
INSERT INTO "LedgerGroup" ("id", "code", "name", "nature", "updatedAt")
VALUES
  ('00000000-0000-4000-8000-000000000001', 'ASSETS', 'Assets', 'DEBIT', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000002', 'LIABILITIES', 'Liabilities', 'CREDIT', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000003', 'INCOME', 'Income', 'CREDIT', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000004', 'EXPENSES', 'Expenses', 'DEBIT', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Tally-style primary/child groups.
INSERT INTO "LedgerGroup" ("id", "code", "name", "parentId", "nature", "updatedAt")
SELECT child.id, child.code, child.name, parent.id, child.nature::"LedgerNature", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('00000000-0000-4000-8000-000000000101', 'CASH_IN_HAND', 'Cash-in-Hand', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000102', 'BANK_ACCOUNTS', 'Bank Accounts', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000103', 'SUNDRY_DEBTORS', 'Sundry Debtors', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000104', 'FIXED_ASSETS', 'Fixed Assets', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000105', 'INPUT_GST_CGST', 'Input GST CGST', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000106', 'INPUT_GST_SGST', 'Input GST SGST', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000107', 'INPUT_GST_IGST', 'Input GST IGST', 'ASSETS', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000201', 'SUNDRY_CREDITORS', 'Sundry Creditors', 'LIABILITIES', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000202', 'LOANS', 'Loans', 'LIABILITIES', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000203', 'DUTIES_AND_TAXES', 'Duties & Taxes', 'LIABILITIES', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000207', 'SUSPENSE_ACCOUNT', 'Suspense Account', 'LIABILITIES', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000301', 'SALES', 'Sales', 'INCOME', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000302', 'DIRECT_INCOME', 'Direct Income', 'INCOME', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000303', 'INDIRECT_INCOME', 'Indirect Income', 'INCOME', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000401', 'PURCHASE', 'Purchase', 'EXPENSES', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000402', 'DIRECT_EXPENSE', 'Direct Expense', 'EXPENSES', 'DEBIT'),
    ('00000000-0000-4000-8000-000000000403', 'INDIRECT_EXPENSE', 'Indirect Expense', 'EXPENSES', 'DEBIT')
) AS child(id, code, name, parent_code, nature)
JOIN "LedgerGroup" parent ON parent.code = child.parent_code
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "LedgerGroup" ("id", "code", "name", "parentId", "nature", "updatedAt")
SELECT child.id, child.code, child.name, parent.id, child.nature::"LedgerNature", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('00000000-0000-4000-8000-000000000204', 'OUTPUT_GST_CGST', 'Output GST CGST', 'DUTIES_AND_TAXES', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000205', 'OUTPUT_GST_SGST', 'Output GST SGST', 'DUTIES_AND_TAXES', 'CREDIT'),
    ('00000000-0000-4000-8000-000000000206', 'OUTPUT_GST_IGST', 'Output GST IGST', 'DUTIES_AND_TAXES', 'CREDIT')
) AS child(id, code, name, parent_code, nature)
JOIN "LedgerGroup" parent ON parent.code = child.parent_code
ON CONFLICT ("code") DO NOTHING;

-- Ledger master metadata.
ALTER TABLE "Ledger" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Ledger" ADD COLUMN "nature" "LedgerNature";
ALTER TABLE "Ledger" ADD COLUMN "gstApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ledger" ADD COLUMN "gstin" TEXT;
ALTER TABLE "Ledger" ADD COLUMN "pan" TEXT;
ALTER TABLE "Ledger" ADD COLUMN "creditLimit" DECIMAL(18,2);
ALTER TABLE "Ledger" ADD COLUMN "createdById" TEXT;

UPDATE "Ledger"
SET
  "groupId" = CASE
    WHEN "category" = 'CUSTOMER' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'SUNDRY_DEBTORS')
    WHEN "category" = 'VENDOR' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'SUNDRY_CREDITORS')
    WHEN "category" = 'BANK' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'BANK_ACCOUNTS')
    WHEN "category" = 'CASH' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'CASH_IN_HAND')
    WHEN "category" = 'GST' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'DUTIES_AND_TAXES')
    WHEN "category" = 'SALES' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'SALES')
    WHEN "category" = 'PURCHASE' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'PURCHASE')
    WHEN "category" = 'SUSPENSE' THEN (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'SUSPENSE_ACCOUNT')
    ELSE (SELECT "id" FROM "LedgerGroup" WHERE "code" = 'ASSETS')
  END,
  "nature" = CASE
    WHEN "category" IN ('VENDOR', 'GST', 'SALES', 'SUSPENSE') THEN 'CREDIT'::"LedgerNature"
    ELSE 'DEBIT'::"LedgerNature"
  END;

ALTER TABLE "Ledger" ALTER COLUMN "groupId" SET NOT NULL;
ALTER TABLE "Ledger" ALTER COLUMN "nature" SET NOT NULL;

CREATE INDEX "Ledger_groupId_idx" ON "Ledger"("groupId");
CREATE INDEX "Ledger_nature_idx" ON "Ledger"("nature");
CREATE INDEX "Ledger_gstin_idx" ON "Ledger"("gstin");
CREATE INDEX "Ledger_pan_idx" ON "Ledger"("pan");
CREATE INDEX "Ledger_createdById_idx" ON "Ledger"("createdById");

ALTER TABLE "Ledger"
ADD CONSTRAINT "Ledger_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "LedgerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Ledger"
ADD CONSTRAINT "Ledger_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Voucher"
SET "sourceId" = "id"
WHERE "sourceId" IS NULL;

ALTER TABLE "Voucher" ALTER COLUMN "sourceId" SET NOT NULL;

