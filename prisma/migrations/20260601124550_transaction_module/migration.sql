-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('INWARD', 'OUTWARD');

-- CreateEnum
CREATE TYPE "TransactionPaymentType" AS ENUM ('NORMAL', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AllocationSource" AS ENUM ('SALE', 'PURCHASE');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "transactionNo" TEXT NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "branchId" TEXT NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "suspenseAccount" BOOLEAN NOT NULL DEFAULT false,
    "agencyId" TEXT,
    "paymentType" "TransactionPaymentType" NOT NULL,
    "thirdPartyAgencyId" TEXT,
    "transactionRefNo" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "remarks" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAllocation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sourceType" "AllocationSource" NOT NULL,
    "saleId" TEXT,
    "purchaseId" TEXT,
    "allocatedAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_transactionNo_key" ON "Transaction"("transactionNo");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_thirdPartyAgencyId_fkey" FOREIGN KEY ("thirdPartyAgencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAllocation" ADD CONSTRAINT "TransactionAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAllocation" ADD CONSTRAINT "TransactionAllocation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAllocation" ADD CONSTRAINT "TransactionAllocation_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
