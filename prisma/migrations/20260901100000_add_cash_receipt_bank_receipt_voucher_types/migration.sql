-- Distinguish cash and bank receipts from payments imported from Tally.
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'CASH_RECEIPT';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'BANK_RECEIPT';
