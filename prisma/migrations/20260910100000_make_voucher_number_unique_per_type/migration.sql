DROP INDEX IF EXISTS "Voucher_voucherNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Voucher_voucherNo_voucherType_key"
ON "Voucher"("voucherNo", "voucherType");
