INSERT INTO "LedgerGroup" ("id", "code", "name", "nature", "updatedAt")
VALUES (
    '00000000-0000-4000-8000-000000000006',
    'SALES_ACCOUNTS',
    'Sales Accounts',
    'CREDIT',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "nature" = EXCLUDED."nature",
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "LedgerGroup"
SET
    "parentId" = (
        SELECT "id" FROM "LedgerGroup" WHERE "code" = 'SALES_ACCOUNTS'
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'SALES';

INSERT INTO "LedgerGroup" ("id", "code", "name", "parentId", "nature", "updatedAt")
SELECT
    '00000000-0000-4000-8000-000000000007',
    'SALES',
    'Sales',
    "id",
    'CREDIT',
    CURRENT_TIMESTAMP
FROM "LedgerGroup"
WHERE "code" = 'SALES_ACCOUNTS'
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "parentId" = EXCLUDED."parentId",
    "nature" = EXCLUDED."nature",
    "updatedAt" = CURRENT_TIMESTAMP;
