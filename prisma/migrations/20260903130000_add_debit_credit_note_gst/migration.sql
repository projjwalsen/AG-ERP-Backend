ALTER TABLE "DebitCreditNote"
    ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0.00;

-- GSTR-1 outward credit/debit notes from Tally's voucher register.
UPDATE "DebitCreditNote" SET "taxableAmount" = 221130, "cgstAmount" = 19901.70, "sgstAmount" = 19901.70, "igstAmount" = 0 WHERE "noteNo" = 'SDN/M/2526/001';
UPDATE "DebitCreditNote" SET "taxableAmount" = -908.60, "cgstAmount" = -81.77, "sgstAmount" = -81.77, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/001';
UPDATE "DebitCreditNote" SET "taxableAmount" = 53889, "cgstAmount" = 4850.01, "sgstAmount" = 4850.01, "igstAmount" = 0 WHERE "noteNo" = 'SDN/M/2526/002';
UPDATE "DebitCreditNote" SET "taxableAmount" = 5200, "cgstAmount" = 468, "sgstAmount" = 468, "igstAmount" = 0 WHERE "noteNo" = 'SDN/M/2526/003';
UPDATE "DebitCreditNote" SET "taxableAmount" = -2456689, "cgstAmount" = -221102.01, "sgstAmount" = -221102.01, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/002';
UPDATE "DebitCreditNote" SET "taxableAmount" = 135184, "cgstAmount" = 0, "sgstAmount" = 0, "igstAmount" = 24333.12 WHERE "noteNo" = 'SDN/M/2526/004';
UPDATE "DebitCreditNote" SET "taxableAmount" = -7633.05, "cgstAmount" = -686.97, "sgstAmount" = -686.97, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/003';
UPDATE "DebitCreditNote" SET "taxableAmount" = 98671, "cgstAmount" = 0, "sgstAmount" = 0, "igstAmount" = 17760.78 WHERE "noteNo" = 'SDN/M/2526/005';
UPDATE "DebitCreditNote" SET "taxableAmount" = 31750, "cgstAmount" = 0, "sgstAmount" = 0, "igstAmount" = 5715 WHERE "noteNo" = 'SDN/M/2526/006';
UPDATE "DebitCreditNote" SET "taxableAmount" = -184041, "cgstAmount" = -16563.69, "sgstAmount" = -16563.69, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/005';
UPDATE "DebitCreditNote" SET "taxableAmount" = 52975, "cgstAmount" = 4767.75, "sgstAmount" = 4767.75, "igstAmount" = 0 WHERE "noteNo" = 'SDN/M/2526/007';
UPDATE "DebitCreditNote" SET "taxableAmount" = -8960000, "cgstAmount" = -806400, "sgstAmount" = -806400, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/006';
UPDATE "DebitCreditNote" SET "taxableAmount" = -10240000, "cgstAmount" = -921600, "sgstAmount" = -921600, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/007';
UPDATE "DebitCreditNote" SET "taxableAmount" = 380970, "cgstAmount" = 34287.30, "sgstAmount" = 34287.30, "igstAmount" = 0 WHERE "noteNo" = 'SDN/M/2526/008';
UPDATE "DebitCreditNote" SET "taxableAmount" = -10747.72, "cgstAmount" = 0, "sgstAmount" = 0, "igstAmount" = -1934.59 WHERE "noteNo" = 'SCN/M/2526/008';
UPDATE "DebitCreditNote" SET "taxableAmount" = -24366.30, "cgstAmount" = 0, "sgstAmount" = 0, "igstAmount" = -4385.93 WHERE "noteNo" = 'SCN/M/2526/009';
UPDATE "DebitCreditNote" SET "taxableAmount" = -1173840, "cgstAmount" = -105645.60, "sgstAmount" = -105645.60, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/010';
UPDATE "DebitCreditNote" SET "taxableAmount" = -1177190, "cgstAmount" = -105947.10, "sgstAmount" = -105947.10, "igstAmount" = 0 WHERE "noteNo" = 'SCN/M/2526/011';
