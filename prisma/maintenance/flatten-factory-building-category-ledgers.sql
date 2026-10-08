-- Move category ledgers directly under the Factory Building ledger group.
-- This removes the visual wrapper levels:
--   Factory Building -> CEMENT -> CEMENT
--   Factory Building -> Factory Assets -> Factory Assets
--   Factory Building -> Factory Construction -> Factory Construction
--
-- The empty legacy wrapper groups are preserved for historical safety.

BEGIN;

UPDATE public."Ledger"
SET "groupId" = 'f983a738-dbc3-4045-bad9-8d78159905c5',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id IN (
    '4e8e6cdd-53bf-489f-a2c4-37301b2eef32', -- CEMENT
    '19e2fbb5-d6e1-4915-b26f-984bdbe90c42', -- Factory Assets
    'a8879c6e-b084-41ac-9bd2-c1d2a96f2bf9'  -- Factory Construction
)
AND "groupId" <> 'f983a738-dbc3-4045-bad9-8d78159905c5';

COMMIT;

-- Verification
SELECT
    l.id AS ledger_id,
    l.name AS ledger_name,
    l."groupId",
    g.name AS ledger_group_name,
    g."parentId" AS ledger_group_parent_id
FROM public."Ledger" l
JOIN public."LedgerGroup" g ON g.id = l."groupId"
WHERE l.id IN (
    '4e8e6cdd-53bf-489f-a2c4-37301b2eef32',
    '19e2fbb5-d6e1-4915-b26f-984bdbe90c42',
    'a8879c6e-b084-41ac-9bd2-c1d2a96f2bf9'
)
ORDER BY l.name;
