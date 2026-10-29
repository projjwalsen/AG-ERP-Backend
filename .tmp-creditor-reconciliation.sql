BEGIN;
DO $$
DECLARE n integer; duplicate_count integer;
BEGIN
  SELECT count(*) INTO n FROM "LedgerEntry" le JOIN "Voucher" v ON v.id=le."voucherId"
  WHERE le."ledgerId"='e8709102-bc3e-4811-930a-b7072b81a6c8'
    AND ((v."voucherNo"='14223' AND v."voucherType"='PAYMENT' AND le."entryType"='DEBIT' AND le.amount=5000.00 AND v."voucherDate"::date='2025-10-09')
      OR (v."voucherNo"='14391' AND v."voucherType"='PAYMENT' AND le."entryType"='DEBIT' AND le.amount=100000.00 AND v."voucherDate"::date='2025-10-16'));
  SELECT count(*) INTO duplicate_count FROM "LedgerEntry" le JOIN "Voucher" v ON v.id=le."voucherId"
  WHERE le."ledgerId"='1b31070e-c9a2-4997-bda6-8613bbc8c5ce' AND v."voucherNo" IN ('14223','14391');
  IF n<>2 OR duplicate_count<>0 THEN RAISE EXCEPTION 'Expected exactly two source-matched vouchers on the duplicate ledger and none on the main ledger; got % and %',n,duplicate_count; END IF;
END $$;
UPDATE "LedgerEntry" le SET "ledgerId"='1b31070e-c9a2-4997-bda6-8613bbc8c5ce'
FROM "Voucher" v WHERE le."voucherId"=v.id AND le."ledgerId"='e8709102-bc3e-4811-930a-b7072b81a6c8'
AND ((v."voucherNo"='14223' AND v."voucherType"='PAYMENT') OR (v."voucherNo"='14391' AND v."voucherType"='PAYMENT'));
UPDATE "Ledger" l SET "currentBalance"=COALESCE((SELECT sum(CASE WHEN le."entryType"='DEBIT' THEN le.amount ELSE -le.amount END) FROM "LedgerEntry" le WHERE le."ledgerId"=l.id),0),"updatedAt"=now()
WHERE l.id IN ('1b31070e-c9a2-4997-bda6-8613bbc8c5ce','e8709102-bc3e-4811-930a-b7072b81a6c8');
UPDATE "Ledger" SET "isActive"=false,"currentBalance"=0,"updatedAt"=now() WHERE id='e8709102-bc3e-4811-930a-b7072b81a6c8' AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" le WHERE le."ledgerId"='e8709102-bc3e-4811-930a-b7072b81a6c8');
COMMIT;
SELECT l.id,l.name,l."isActive",l."currentBalance",count(le.id) entries FROM "Ledger" l LEFT JOIN "LedgerEntry" le ON le."ledgerId"=l.id WHERE l.id IN ('1b31070e-c9a2-4997-bda6-8613bbc8c5ce','e8709102-bc3e-4811-930a-b7072b81a6c8') GROUP BY 1,2,3,4 ORDER BY l.id;
