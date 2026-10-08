-- Repair only stale wrapper ledgers used as journal-head containers.
--
-- No JournalHead or JournalCategory rows are deleted or re-parented.
-- The Building category does not exist; the unwanted Trial Balance row is
-- the active ledger belonging to the Building journal subhead.
--
-- Keep the category ledger structure:
--   Building -> Factory Building -> CEMENT
--                              -> Factory Assets
--                              -> Factory Construction

BEGIN;

-- Preserve the ledger and its accounting history, but prevent the wrapper
-- ledger from appearing as an additional leaf account in reports and normal
-- ledger selection.
UPDATE public."Ledger"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'a27b32dc-e4f3-4401-87db-767beb8ba6ca'
  AND lower(trim(name)) = 'building';

-- Ensure the actual Factory Assets category ledger remains active and is
-- directly under the Factory Building ledger group.
UPDATE public."Ledger"
SET "isActive" = true,
    "groupId" = 'f983a738-dbc3-4045-bad9-8d78159905c5',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id = '19e2fbb5-d6e1-4915-b26f-984bdbe90c42'
  AND lower(trim(name)) = 'factory assets';

COMMIT;

-- Verification
SELECT
    l.id,
    l.name,
    l."isActive",
    l."groupId",
    g.name AS group_name
FROM public."Ledger" l
LEFT JOIN public."LedgerGroup" g ON g.id = l."groupId"
WHERE l.id IN (
    'a27b32dc-e4f3-4401-87db-767beb8ba6ca',
    '19e2fbb5-d6e1-4915-b26f-984bdbe90c42'
)
ORDER BY l.name;
