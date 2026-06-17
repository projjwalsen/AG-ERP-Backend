/*
  Warnings:

  - The values [SALES,TRANSACTION] on the enum `VoucherType` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[voucherType,sourceId]` on the table `Voucher` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "VoucherType_new" AS ENUM ('SALE', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'JOURNAL', 'CONTRA', 'OPENING_BALANCE');
ALTER TABLE "Voucher" ALTER COLUMN "voucherType" TYPE "VoucherType_new" USING ("voucherType"::text::"VoucherType_new");
ALTER TYPE "VoucherType" RENAME TO "VoucherType_old";
ALTER TYPE "VoucherType_new" RENAME TO "VoucherType";
DROP TYPE "public"."VoucherType_old";
COMMIT;

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_voucherType_sourceId_key" ON "Voucher"("voucherType", "sourceId");
