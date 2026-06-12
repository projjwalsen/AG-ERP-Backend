-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('CUSTOMER', 'VENDOR', 'BANK', 'CASH', 'GST', 'SALES', 'PURCHASE', 'EXPENSE', 'INCOME', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('SALES', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'JOURNAL', 'CONTRA');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LedgerType" NOT NULL,
    "branchId" TEXT,
    "agencyId" TEXT,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    "currentBalance" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "sourceId" TEXT,
    "narration" TEXT,
    "totalDebit" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    "totalCredit" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    "voucherDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "entryType" "EntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_code_key" ON "Ledger"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_agencyId_key" ON "Ledger"("agencyId");

-- CreateIndex
CREATE INDEX "Ledger_agencyId_idx" ON "Ledger"("agencyId");

-- CreateIndex
CREATE INDEX "Ledger_branchId_idx" ON "Ledger"("branchId");

-- CreateIndex
CREATE INDEX "Ledger_category_idx" ON "Ledger"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_voucherNo_key" ON "Voucher"("voucherNo");

-- CreateIndex
CREATE INDEX "Voucher_voucherType_idx" ON "Voucher"("voucherType");

-- CreateIndex
CREATE INDEX "Voucher_sourceId_idx" ON "Voucher"("sourceId");

-- CreateIndex
CREATE INDEX "LedgerEntry_ledgerId_idx" ON "LedgerEntry"("ledgerId");

-- CreateIndex
CREATE INDEX "LedgerEntry_voucherId_idx" ON "LedgerEntry"("voucherId");

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
