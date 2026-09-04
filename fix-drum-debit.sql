-- Moves the existing Drum balance from CREDIT to DEBIT and keeps it under
-- Expenses -> Direct Expense -> Consumable Product.
-- The current data contains two credit sources:
--   1. a synthetic opening credit of 20,160
--   2. one LedgerEntry credit of 20,160
-- This repair keeps the actual LedgerEntry and removes the duplicate
-- synthetic opening amount, resulting in Drum 20,160 Debit.

BEGIN;

CREATE TEMP TABLE target_drum ON COMMIT DROP AS
SELECT l.id
FROM "Ledger" l
WHERE UPPER(TRIM(l.name)) IN ('DRUM', 'DRUMS')
  AND l."isActive" = TRUE;

DO $$
DECLARE
    drum_count INTEGER;
    group_count INTEGER;
    opening_debit NUMERIC;
    opening_credit NUMERIC;
    opening_balance NUMERIC;
    ledger_nature TEXT;
    entry_debit NUMERIC;
    entry_credit NUMERIC;
    opening_signed NUMERIC;
    current_signed NUMERIC;
BEGIN
    SELECT COUNT(*) INTO drum_count FROM target_drum;
    IF drum_count <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one active Drum ledger; found %', drum_count;
    END IF;

    SELECT COUNT(*) INTO group_count
    FROM "LedgerGroup"
    WHERE code = 'CONSUMABLE_PRODUCT';
    IF group_count <> 1 THEN
        RAISE EXCEPTION 'Consumable Product ledger group was not found exactly once';
    END IF;

    SELECT
        COALESCE(l."openingDebit", 0),
        COALESCE(l."openingCredit", 0),
        COALESCE(l."openingBalance", 0),
        l.nature::TEXT,
        COALESCE(SUM(CASE WHEN le."entryType"::TEXT = 'DEBIT' THEN le.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN le."entryType"::TEXT = 'CREDIT' THEN le.amount ELSE 0 END), 0)
    INTO opening_debit, opening_credit, opening_balance, ledger_nature,
         entry_debit, entry_credit
    FROM "Ledger" l
    JOIN target_drum td ON td.id = l.id
    LEFT JOIN "LedgerEntry" le ON le."ledgerId" = l.id
    GROUP BY l."openingDebit", l."openingCredit", l."openingBalance", l.nature;

    opening_signed := CASE
        WHEN opening_debit <> 0 OR opening_credit <> 0
            THEN opening_debit - opening_credit
        WHEN ledger_nature = 'CREDIT'
            THEN -opening_balance
        ELSE opening_balance
    END;

    current_signed := opening_signed + entry_debit - entry_credit;

    IF entry_debit <> 0
       OR ROUND(entry_credit, 2) <> 20160.00
       OR ROUND(current_signed, 2) <> -40320.00 THEN
        RAISE EXCEPTION
            'Expected duplicate Drum credits: entry debit 0, entry credit 20160, signed balance -40320. Found entry debit %, entry credit %, signed balance %',
            entry_debit, entry_credit, current_signed;
    END IF;
END $$;

-- Existing Drum ledger entries, if any, are currently credit-side entries.
-- Move them to debit. The guard above ensures they are the only movement side.
UPDATE "LedgerEntry" le
SET "entryType" = 'DEBIT'::"EntryType"
FROM target_drum td
WHERE le."ledgerId" = td.id
  AND le."entryType" = 'CREDIT'::"EntryType";

-- Remove the duplicate synthetic opening balance. The actual 20,160
-- LedgerEntry is retained and changed to DEBIT above.
UPDATE "Ledger" l
SET
    "openingDebit" = 0,
    "openingCredit" = 0,
    "openingBalance" = 0,
    nature = 'DEBIT'::"LedgerNature",
    "groupId" = (
        SELECT id FROM "LedgerGroup" WHERE code = 'CONSUMABLE_PRODUCT'
    ),
    "isActive" = TRUE
FROM target_drum td
WHERE l.id = td.id;

-- Keep the JournalHead direction consistent for future postings.
UPDATE "JournalHead" jh
SET type = 'OUTWARD'::"JournalHeadType",
    "isActive" = TRUE
FROM target_drum td
WHERE jh."ledgerId" = td.id;

-- Refresh the cached balance after changing the posting side.
UPDATE "Ledger" l
SET "currentBalance" =
    COALESCE(l."openingDebit", 0) - COALESCE(l."openingCredit", 0)
    + COALESCE((
        SELECT SUM(CASE
            WHEN le."entryType" = 'DEBIT'::"EntryType" THEN le.amount
            ELSE -le.amount
        END)
        FROM "LedgerEntry" le
        WHERE le."ledgerId" = l.id
    ), 0)
FROM target_drum td
WHERE l.id = td.id;

-- Verify the final result before committing.
SELECT
    l.id AS ledger_id,
    l.name AS ledger_name,
    lg.name AS group_name,
    l.nature,
    l."openingDebit",
    l."openingCredit",
    COALESCE(SUM(CASE WHEN le."entryType" = 'DEBIT'::"EntryType" THEN le.amount ELSE 0 END), 0) AS entry_debit,
    COALESCE(SUM(CASE WHEN le."entryType" = 'CREDIT'::"EntryType" THEN le.amount ELSE 0 END), 0) AS entry_credit,
    l."currentBalance"
FROM "Ledger" l
JOIN target_drum td ON td.id = l.id
JOIN "LedgerGroup" lg ON lg.id = l."groupId"
LEFT JOIN "LedgerEntry" le ON le."ledgerId" = l.id
GROUP BY l.id, l.name, lg.name, l.nature, l."openingDebit", l."openingCredit", l."currentBalance";

COMMIT;
