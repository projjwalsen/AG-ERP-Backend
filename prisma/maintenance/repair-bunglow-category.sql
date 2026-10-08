-- COMMIT: keep Bunglow only as a category under Building.
--
-- Confirmed by the preview:
--   Building head:              49a0f57d-1087-4976-8503-c85cb1f2c9f1
--   Nested Bunglow head:        5d3f7854-7917-4f29-857c-151311a57264
--   Canonical Bunglow category: b1d7f417-4265-45c7-910e-de49316d7844
--   Duplicate Bunglow category: bb5f5e93-0090-422a-98d6-977f2a573de2

BEGIN;

UPDATE public."Journal"
SET "journalHeadId" = '49a0f57d-1087-4976-8503-c85cb1f2c9f1',
    "categoryId" = 'b1d7f417-4265-45c7-910e-de49316d7844',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "journalHeadId" = '5d3f7854-7917-4f29-857c-151311a57264'
   OR "categoryId" = 'bb5f5e93-0090-422a-98d6-977f2a573de2';

DELETE FROM public."JournalCategory"
WHERE id = 'bb5f5e93-0090-422a-98d6-977f2a573de2';

-- Preserve the head because its ledger/accounting history may reference it.
-- Deactivation removes it from normal journal-head selection.
UPDATE public."JournalHead"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id = '5d3f7854-7917-4f29-857c-151311a57264';

COMMIT;

-- Verification
SELECT
    j.id AS journal_id,
    j."journalHeadId",
    j."categoryId",
    h.name AS journal_head_name,
    c.name AS category_name
FROM public."Journal" j
JOIN public."JournalHead" h ON h.id = j."journalHeadId"
LEFT JOIN public."JournalCategory" c ON c.id = j."categoryId"
WHERE j."categoryId" = 'b1d7f417-4265-45c7-910e-de49316d7844';

SELECT id, name, "isActive"
FROM public."JournalHead"
WHERE id = '5d3f7854-7917-4f29-857c-151311a57264';
