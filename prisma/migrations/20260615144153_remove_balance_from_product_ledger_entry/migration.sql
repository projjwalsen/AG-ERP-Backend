/*
  Warnings:

  - The values [EXPENSE,INCOME] on the enum `LedgerType` will be removed. If these variants are still used in the database, this will fail.
  - The values [RECEIPT,PAYMENT,CONTRA] on the enum `VoucherType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "OutstandingType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ProductMovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE', 'SALE', 'RETURN_IN', 'RETURN_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "ProductMovementDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterEnum
BEGIN;
CREATE TYPE "LedgerType_new" AS ENUM ('CUSTOMER', 'VENDOR', 'BANK', 'CASH', 'GST', 'SALES', 'PURCHASE', 'PRODUCT', 'SUSPENSE');
ALTER TABLE "Ledger" ALTER COLUMN "category" TYPE "LedgerType_new" USING ("category"::text::"LedgerType_new");
ALTER TYPE "LedgerType" RENAME TO "LedgerType_old";
ALTER TYPE "LedgerType_new" RENAME TO "LedgerType";
DROP TYPE "public"."LedgerType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "VoucherType_new" AS ENUM ('SALES', 'PURCHASE', 'TRANSACTION', 'JOURNAL', 'OPENING_BALANCE');
ALTER TABLE "Voucher" ALTER COLUMN "voucherType" TYPE "VoucherType_new" USING ("voucherType"::text::"VoucherType_new");
ALTER TYPE "VoucherType" RENAME TO "VoucherType_old";
ALTER TYPE "VoucherType_new" RENAME TO "VoucherType";
DROP TYPE "public"."VoucherType_old";
COMMIT;

-- DropIndex
DROP INDEX "Ledger_agencyId_key";

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "amountPayable" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "amountReceivable" DECIMAL(18,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "Ledger" ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "branchId" TEXT;

-- CreateTable
CREATE TABLE "AgencyOutstanding" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "OutstandingType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyOutstanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductLedger" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductLedgerEntry" (
    "id" TEXT NOT NULL,
    "productLedgerId" TEXT NOT NULL,
    "movementType" "ProductMovementType" NOT NULL,
    "direction" "ProductMovementDirection" NOT NULL,
    "quantityKG" DECIMAL(18,3) NOT NULL,
    "quantityLTR" DECIMAL(18,3),
    "unit" "ProductUnit" NOT NULL,
    "branchId" TEXT,
    "agencyId" TEXT,
    "purchaseId" TEXT,
    "saleId" TEXT,
    "batchId" TEXT,
    "batchNo" TEXT,
    "invoiceNo" TEXT,
    "unitCost" DECIMAL(18,2),
    "totalCost" DECIMAL(18,2),
    "entryDate" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ProductLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgencyOutstanding_agencyId_idx" ON "AgencyOutstanding"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyOutstanding_branchId_idx" ON "AgencyOutstanding"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyOutstanding_agencyId_branchId_key" ON "AgencyOutstanding"("agencyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLedger_productId_key" ON "ProductLedger"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLedger_code_key" ON "ProductLedger"("code");

-- CreateIndex
CREATE INDEX "ProductLedger_productId_idx" ON "ProductLedger"("productId");

-- CreateIndex
CREATE INDEX "ProductLedger_code_idx" ON "ProductLedger"("code");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_productLedgerId_idx" ON "ProductLedgerEntry"("productLedgerId");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_purchaseId_idx" ON "ProductLedgerEntry"("purchaseId");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_saleId_idx" ON "ProductLedgerEntry"("saleId");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_branchId_idx" ON "ProductLedgerEntry"("branchId");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_agencyId_idx" ON "ProductLedgerEntry"("agencyId");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_batchId_idx" ON "ProductLedgerEntry"("batchId");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_entryDate_idx" ON "ProductLedgerEntry"("entryDate");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_createdAt_idx" ON "ProductLedgerEntry"("createdAt");

-- CreateIndex
CREATE INDEX "ProductLedgerEntry_movementType_idx" ON "ProductLedgerEntry"("movementType");

-- CreateIndex
CREATE INDEX "Ledger_productId_idx" ON "Ledger"("productId");

-- CreateIndex
CREATE INDEX "LedgerEntry_branchId_idx" ON "LedgerEntry"("branchId");

-- CreateIndex
CREATE INDEX "LedgerEntry_productId_idx" ON "LedgerEntry"("productId");

-- CreateIndex
CREATE INDEX "Purchase_agencyId_idx" ON "Purchase"("agencyId");

-- CreateIndex
CREATE INDEX "Purchase_branchId_idx" ON "Purchase"("branchId");

-- CreateIndex
CREATE INDEX "Purchase_status_idx" ON "Purchase"("status");

-- CreateIndex
CREATE INDEX "Sale_agencyId_idx" ON "Sale"("agencyId");

-- CreateIndex
CREATE INDEX "Sale_branchId_idx" ON "Sale"("branchId");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Voucher_branchId_idx" ON "Voucher"("branchId");

-- AddForeignKey
ALTER TABLE "AgencyOutstanding" ADD CONSTRAINT "AgencyOutstanding_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyOutstanding" ADD CONSTRAINT "AgencyOutstanding_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedger" ADD CONSTRAINT "ProductLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_productLedgerId_fkey" FOREIGN KEY ("productLedgerId") REFERENCES "ProductLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLedgerEntry" ADD CONSTRAINT "ProductLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
