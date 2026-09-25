ALTER TABLE "Journal" ADD COLUMN IF NOT EXISTS "serialNo" TEXT;
ALTER TABLE "Journal" ADD COLUMN IF NOT EXISTS "voucherNo" TEXT;
ALTER TABLE "Journal" ADD COLUMN IF NOT EXISTS "sourceSheet" TEXT;
ALTER TABLE "Journal" ADD COLUMN IF NOT EXISTS "sourceRow" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "Journal_branchId_serialNo_key"
ON "Journal"("branchId", "serialNo");

DROP INDEX IF EXISTS "Voucher_voucherNo_voucherType_key";
CREATE INDEX IF NOT EXISTS "Voucher_voucherNo_voucherType_idx"
ON "Voucher"("voucherNo", "voucherType");
