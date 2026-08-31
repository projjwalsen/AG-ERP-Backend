-- Add distinct voucher types for cash and bank payments.
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'CASH_PAYMENT';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'BANK_PAYMENT';
