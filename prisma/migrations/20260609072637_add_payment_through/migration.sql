-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('NEFT', 'RTGS', 'BANK_DEPOSIT', 'UPI', 'CHEQUE', 'DD', 'CASH');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "paymentThrough" "PaymentType",
ADD COLUMN     "referenceNo" TEXT;
