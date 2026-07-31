-- CreateEnum
CREATE TYPE "DebitCreditNoteType" AS ENUM ('DEBIT_NOTE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "DebitCreditNoteStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DebitCreditNoteSourceType" AS ENUM ('SALE', 'PURCHASE');

-- AlterEnum
ALTER TYPE "VoucherType" ADD VALUE 'DEBIT_NOTE';
ALTER TYPE "VoucherType" ADD VALUE 'CREDIT_NOTE';

-- CreateTable
CREATE TABLE "DebitCreditNote" (
    "id" TEXT NOT NULL,
    "noteNo" TEXT NOT NULL,
    "type" "DebitCreditNoteType" NOT NULL,
    "sourceType" "DebitCreditNoteSourceType" NOT NULL,
    "agencyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT,
    "purchaseId" TEXT,
    "noteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "narration" TEXT,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    "status" "DebitCreditNoteStatus" NOT NULL DEFAULT 'PENDING',
    "voucherId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebitCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitCreditNoteParticular" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebitCreditNoteParticular_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebitCreditNote_noteNo_key" ON "DebitCreditNote"("noteNo");

-- CreateIndex
CREATE INDEX "DebitCreditNote_agencyId_idx" ON "DebitCreditNote"("agencyId");

-- CreateIndex
CREATE INDEX "DebitCreditNote_branchId_idx" ON "DebitCreditNote"("branchId");

-- CreateIndex
CREATE INDEX "DebitCreditNote_saleId_idx" ON "DebitCreditNote"("saleId");

-- CreateIndex
CREATE INDEX "DebitCreditNote_purchaseId_idx" ON "DebitCreditNote"("purchaseId");

-- CreateIndex
CREATE INDEX "DebitCreditNote_sourceType_idx" ON "DebitCreditNote"("sourceType");

-- CreateIndex
CREATE INDEX "DebitCreditNote_status_idx" ON "DebitCreditNote"("status");

-- CreateIndex
CREATE INDEX "DebitCreditNote_type_idx" ON "DebitCreditNote"("type");

-- CreateIndex
CREATE INDEX "DebitCreditNote_voucherId_idx" ON "DebitCreditNote"("voucherId");

-- CreateIndex
CREATE INDEX "DebitCreditNoteParticular_noteId_idx" ON "DebitCreditNoteParticular"("noteId");

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNote" ADD CONSTRAINT "DebitCreditNote_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitCreditNoteParticular" ADD CONSTRAINT "DebitCreditNoteParticular_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "DebitCreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
