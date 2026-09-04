-- Reconcile accounting after Sale GST values were repaired.
-- This does not modify Sale, Agency, Ledger master, or inventory records.
-- Run the DRY RUN query first. Review the result, then run the APPLY section.

DROP TABLE IF EXISTS sale_accounting_repair_targets;

CREATE TEMP TABLE sale_accounting_repair_targets ON COMMIT PRESERVE ROWS AS
SELECT
    s.id AS sale_id,
    s."invoiceNo",
    s."branchId",
    v.id AS voucher_id,
    s."grandTotal",
    s."subTotalAmount",
    s."totalCGSTAmount",
    s."totalSGSTAmount",
    s."totalIGSTAmount"
FROM "Sale" s
JOIN "Voucher" v
  ON v."sourceId" = s.id
 AND v."voucherType" = 'SALE'::"VoucherType"
WHERE COALESCE(s."totalGSTAmount", 0) <> 0
   OR EXISTS (
       SELECT 1
       FROM "LedgerEntry" le
       WHERE le."voucherId" = v.id
         AND le.narration LIKE 'Invoice:' || s."invoiceNo" || ' GST:%'
   );

-- DRY RUN: these are the accounting records that will be reconciled.
SELECT
    COUNT(*) AS sale_vouchers_to_reconcile,
    COUNT(*) FILTER (WHERE "totalIGSTAmount" <> 0) AS invoices_with_igst,
    COUNT(*) FILTER (WHERE "totalCGSTAmount" <> 0) AS invoices_with_cgst,
    COUNT(*) FILTER (WHERE "totalSGSTAmount" <> 0) AS invoices_with_sgst,
    COUNT(*) FILTER (
        WHERE NOT EXISTS (
            SELECT 1 FROM "LedgerEntry" le
            WHERE le."voucherId" = sale_accounting_repair_targets.voucher_id
              AND le.narration LIKE 'Invoice:' || sale_accounting_repair_targets."invoiceNo" || ' GST:%'
        )
    ) AS vouchers_missing_gst_entries
FROM sale_accounting_repair_targets;

-- DRY RUN: invoice-level preview.
SELECT "invoiceNo", sale_id, voucher_id, "grandTotal", "subTotalAmount",
       "totalIGSTAmount", "totalCGSTAmount", "totalSGSTAmount"
FROM sale_accounting_repair_targets
ORDER BY "invoiceNo";

-- APPLY: execute only after reviewing the dry-run output above.
BEGIN;

-- Keep the existing receivable and sales accounting lines in sync with Sale.
UPDATE "LedgerEntry" le
SET amount = t."grandTotal"
FROM sale_accounting_repair_targets t
WHERE le."voucherId" = t.voucher_id
  AND le.narration = 'Invoice:' || t."invoiceNo" || ' Customer Receivable';

UPDATE "LedgerEntry" le
SET amount = t."subTotalAmount"
FROM sale_accounting_repair_targets t
WHERE le."voucherId" = t.voucher_id
  AND le.narration = 'Invoice:' || t."invoiceNo" || ' Sales';

-- Remove old/multiple GST lines for these invoices. Agency and ledger master rows
-- are untouched; only invoice-specific LedgerEntry rows are replaced.
DELETE FROM "LedgerEntry" le
USING sale_accounting_repair_targets t
WHERE le."voucherId" = t.voucher_id
  AND le.narration LIKE 'Invoice:' || t."invoiceNo" || ' GST:%';

-- Recreate exact GST lines using the existing branch output-GST ledgers.
INSERT INTO "LedgerEntry" (id, "voucherId", "ledgerId", "branchId", "entryType", amount, narration, "createdAt")
SELECT gen_random_uuid(), t.voucher_id, gst.id, t."branchId", 'CREDIT'::"EntryType", x.amount,
       'Invoice:' || t."invoiceNo" || ' GST:' || x.tax_kind, now()
FROM sale_accounting_repair_targets t
CROSS JOIN LATERAL (
    VALUES ('CGST', t."totalCGSTAmount"),
           ('SGST', t."totalSGSTAmount"),
           ('IGST', t."totalIGSTAmount")
) AS x(tax_kind, amount)
JOIN LATERAL (
    SELECT l.id
    FROM "Ledger" l
    WHERE l.category = 'GST'::"LedgerType"
      AND l."branchId" = t."branchId"
      AND LOWER(l.name) LIKE LOWER('Output GST ' || x.tax_kind || '%')
    ORDER BY l.id
    LIMIT 1
) gst ON x.amount > 0;

-- Rebuild voucher debit/credit totals from its actual entries.
UPDATE "Voucher" v
SET "totalDebit" = totals.total_debit,
    "totalCredit" = totals.total_credit,
    "updatedAt" = now()
FROM (
    SELECT le."voucherId",
           COALESCE(SUM(le.amount) FILTER (WHERE le."entryType" = 'DEBIT'::"EntryType"), 0) AS total_debit,
           COALESCE(SUM(le.amount) FILTER (WHERE le."entryType" = 'CREDIT'::"EntryType"), 0) AS total_credit
    FROM "LedgerEntry" le
    JOIN sale_accounting_repair_targets t ON t.voucher_id = le."voucherId"
    GROUP BY le."voucherId"
) totals
WHERE v.id = totals."voucherId";

-- Recalculate cached balances for every ledger touched by these vouchers.
WITH affected AS (
    SELECT DISTINCT le."ledgerId"
    FROM "LedgerEntry" le
    JOIN sale_accounting_repair_targets t ON t.voucher_id = le."voucherId"
), balances AS (
    SELECT l.id,
           CASE WHEN l."openingDebit" <> 0 OR l."openingCredit" <> 0
                THEN l."openingDebit" - l."openingCredit"
                ELSE CASE WHEN l.nature = 'CREDIT'::"LedgerNature"
                          THEN -l."openingBalance" ELSE l."openingBalance" END
           END
           + COALESCE(SUM(CASE WHEN le."entryType" = 'DEBIT'::"EntryType"
                               THEN le.amount ELSE -le.amount END), 0) AS balance
    FROM "Ledger" l
    JOIN affected a ON a."ledgerId" = l.id
    LEFT JOIN "LedgerEntry" le ON le."ledgerId" = l.id
    GROUP BY l.id, l."openingDebit", l."openingCredit", l.nature, l."openingBalance"
)
UPDATE "Ledger" l
SET "currentBalance" = b.balance, "updatedAt" = now()
FROM balances b
WHERE l.id = b.id;

COMMIT;

DROP TABLE IF EXISTS sale_accounting_repair_targets;
