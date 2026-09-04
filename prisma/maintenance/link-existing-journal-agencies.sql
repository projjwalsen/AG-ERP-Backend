-- Link existing agencies to matching JournalHead records.
-- Agencies are NOT created or deleted. JournalHead and Journal rows are NOT changed.
-- Journal rows remain connected through JournalHead -> Ledger.

BEGIN;

CREATE TEMP TABLE existing_journal_agency_targets ON COMMIT DROP AS
WITH target_names(name) AS (
    VALUES
    ('ACCELERATOR GENERAL TRADING LLC'),('AINUMPUDI SURESH VARMA'),
    ('ALOIS BUILDERS AND INF'),('AML MOTORS PVT LTD'),('ANGEL TRADING FZE'),
    ('ARKA PETROCHEM FZC'),('ASPHALTERA PRIVATE LIMITED'),('AVNTIKA ENTERPRISE CRS'),
    ('Additional Collector Raigad Alibag'),('Anjali Electricals'),
    ('Automjet Automobiles Private Limited'),('BHAVESH ENGINEERINGS'),('BYTI HOLIDAYS LLP'),
    ('Bunglow Mahanagar Gas Charges'),('DREAMZZ MAKERS EVENTS AN'),
    ('EKVIRA TRANSPORT AND LOGISTICS'),('EMIT INTERNATIONAL FZ LLC'),('GLOBAL PLASTO CHEM'),
    ('HINDUSTAN PETROLEUM CORPORATION LIMITED'),('HRS TRANSPORT'),('INDIAIDEAS.COM'),
    ('INDIAN OIL CORPORATION LIMITED - MH'),('Indian Oil Corporation Limited-GJ'),
    ('JALDEV SHIPPING AGENCY'),('KS Oil Corporation - CR'),('MAYRA PETROLEUM FZCO'),
    ('MSTC LTD'),('Mynd Solutions Pvt. Ltd.'),('NAZPAL OIL ENERGY L.L.C'),
    ('NEW INTERMEDIARY ( BANK OF BARODA )'),
    ('POWER2SME PRIVATE LIMITED(BEBB INDIA PVT LTD)'),('RAAJ UNOCAL LUBRICANTS LTD'),
    ('ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED'),('ROYAL ENTERPRISES'),
    ('SANDEEPDADA THAKUR FOUNDATION'),('SANJIVANI PETROCHEM PRIVATE LIMITED - CR'),
    ('SAYLA ROADLINES'),('SHANTI HEAVY DUTY EARTH MOVERS'),('SHREE HARI ENTERPRISES'),
    ('SIDDHARTH TRADERS'),('SIGMA PETROCHEM'),('SOFTWARES'),('SUKHMANI OIL AND LUBE CRS'),
    ('VIDYAA PETROLEUM INDIA PRIVATE LIMITED - CR')
), matched AS (
    SELECT DISTINCT
        a.id AS agency_id,
        a.name AS agency_name,
        l.id AS ledger_id,
        jh.id AS journal_head_id,
        jh.name AS journal_head_name
    FROM "JournalHead" jh
    JOIN "Ledger" l ON l.id = jh."ledgerId"
    JOIN target_names t ON (
        regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') || '%'
        OR regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g') || '%'
        OR regexp_replace(lower(l.name), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') || '%'
        OR regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(l.name), '[^a-z0-9]', '', 'g') || '%'
    )
    JOIN "Agency" a ON (
        regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') || '%'
        OR regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') LIKE '%' || regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') || '%'
    )
)
SELECT * FROM matched;

-- Match existing JournalHead ledgers to the existing agency.
UPDATE "Ledger" l
SET "agencyId" = t.agency_id,
    "updatedAt" = now()
FROM existing_journal_agency_targets t
WHERE l.id = t.ledger_id
  AND l."agencyId" IS DISTINCT FROM t.agency_id;

-- Make matched agencies usable in both AP and AR.
UPDATE "Agency" a
SET type = 'BOTH'::"AgencyType",
    "amountReceivable" = 0,
    "amountPayable" = 0,
    "updatedAt" = now()
FROM existing_journal_agency_targets t
WHERE a.id = t.agency_id;

-- Clear opening balances for every ledger belonging to the matched agencies.
UPDATE "Ledger" l
SET "openingBalance" = 0,
    "openingDebit" = 0,
    "openingCredit" = 0,
    "openingBalanceDate" = NULL,
    "updatedAt" = now()
FROM (SELECT DISTINCT agency_id FROM existing_journal_agency_targets) t
WHERE l."agencyId" = t.agency_id;

UPDATE "AgencyBranch" ab
SET "openingBalance" = 0,
    "updatedAt" = now()
FROM (SELECT DISTINCT agency_id FROM existing_journal_agency_targets) t
WHERE ab."agencyId" = t.agency_id;

-- Recalculate all affected ledger balances from LedgerEntry and approved Journal rows.
WITH balances AS (
    SELECT l.id,
           COALESCE(SUM(CASE WHEN le."entryType" = 'DEBIT'::"EntryType"
                             THEN le.amount ELSE -le.amount END), 0)
           + COALESCE((
               SELECT SUM(CASE WHEN jh.type = 'INWARD'::"JournalHeadType"
                               THEN j.amount ELSE -j.amount END)
               FROM "Journal" j
               JOIN "JournalHead" jh ON jh.id = j."journalHeadId"
               WHERE jh."ledgerId" = l.id
                 AND j.status = 'APPROVED'::"JournalStatus"
           ), 0) AS balance
    FROM "Ledger" l
    JOIN (SELECT DISTINCT agency_id FROM existing_journal_agency_targets) t
      ON t.agency_id = l."agencyId"
    LEFT JOIN "LedgerEntry" le ON le."ledgerId" = l.id
    GROUP BY l.id
)
UPDATE "Ledger" l
SET "currentBalance" = b.balance,
    "updatedAt" = now()
FROM balances b
WHERE l.id = b.id;

COMMIT;
