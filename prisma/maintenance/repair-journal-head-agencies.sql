-- Repair agencies represented by the listed JournalHead names.
-- This does not delete agencies, journal heads, or journal entries.

DROP TABLE IF EXISTS journal_head_agency_repair_targets;

CREATE TEMP TABLE journal_head_agency_repair_targets ON COMMIT PRESERVE ROWS AS
WITH target_names(name) AS (
    VALUES
    ('ACCELERATOR GENERAL TRADING LLC'),('AINUMPUDI SURESH VARMA'),
    ('ALOIS BUILDERS AND INF'),('AML MOTORS PVT LTD'),('ANGEL TRADING FZE'),
    ('ARKA PETROCHEM FZC'),('ASPHALTERA PRIVATE LIMITED'),('AVNTIKA ENTERPRISE CRS'),
    ('Additional Collector Raigad Alibag'),('Anjali Electricals'),
    ('Automjet Automobiles Private Limited'),('BHAVESH ENGINEERINGS'),
    ('BYTI HOLIDAYS LLP'),('Bunglow Mahanagar Gas Charges'),
    ('DREAMZZ MAKERS EVENTS AN'),('EKVIRA TRANSPORT AND LOGISTICS'),
    ('EMIT INTERNATIONAL FZ LLC'),('GLOBAL PLASTO CHEM'),
    ('HINDUSTAN PETROLEUM CORPORATION LIMITED'),('HRS TRANSPORT'),
    ('INDIAIDEAS.COM'),('INDIAN OIL CORPORATION LIMITED - MH'),
    ('Indian Oil Corporation Limited-GJ'),('JALDEV SHIPPING AGENCY'),
    ('KS Oil Corporation - CR'),('MAYRA PETROLEUM FZCO'),('MSTC LTD'),
    ('Mynd Solutions Pvt. Ltd.'),('NAZPAL OIL ENERGY L.L.C'),
    ('NEW INTERMEDIARY ( BANK OF BARODA )'),
    ('POWER2SME PRIVATE LIMITED(BEBB INDIA PVT LTD)'),
    ('RAAJ UNOCAL LUBRICANTS LTD'),
    ('ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED'),('ROYAL ENTERPRISES'),
    ('SANDEEPDADA THAKUR FOUNDATION'),
    ('SANJIVANI PETROCHEM PRIVATE LIMITED - CR'),('SAYLA ROADLINES'),
    ('SHANTI HEAVY DUTY EARTH MOVERS'),('SHREE HARI ENTERPRISES'),
    ('SIDDHARTH TRADERS'),('SIGMA PETROCHEM'),('SOFTWARES'),
    ('SUKHMANI OIL AND LUBE CRS'),
    ('VIDYAA PETROLEUM INDIA PRIVATE LIMITED - CR')
), matched AS (
    SELECT DISTINCT
        a.id AS agency_id,
        a.name AS agency_name,
        a.type AS current_agency_type,
        l.id AS ledger_id,
        l.name AS ledger_name,
        jh.id AS journal_head_id,
        jh.name AS journal_head_name,
        COUNT(j.id) OVER (PARTITION BY jh.id) AS journal_entry_count
    FROM "JournalHead" jh
    JOIN "Ledger" l ON l.id = jh."ledgerId"
    JOIN "Agency" a ON a.id = l."agencyId"
    LEFT JOIN "Journal" j ON j."journalHeadId" = jh.id
    JOIN target_names t
      ON regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g') =
         regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g')
)
SELECT * FROM matched;

-- Create missing agencies for matching journal heads, if necessary.
-- Existing agencies with the same normalized name are reused.
WITH target_names(name) AS (
    VALUES
    ('ACCELERATOR GENERAL TRADING LLC'),('AINUMPUDI SURESH VARMA'),('ALOIS BUILDERS AND INF'),
    ('AML MOTORS PVT LTD'),('ANGEL TRADING FZE'),('ARKA PETROCHEM FZC'),
    ('ASPHALTERA PRIVATE LIMITED'),('AVNTIKA ENTERPRISE CRS'),('Additional Collector Raigad Alibag'),
    ('Anjali Electricals'),('Automjet Automobiles Private Limited'),('BHAVESH ENGINEERINGS'),
    ('BYTI HOLIDAYS LLP'),('Bunglow Mahanagar Gas Charges'),('DREAMZZ MAKERS EVENTS AN'),
    ('EKVIRA TRANSPORT AND LOGISTICS'),('EMIT INTERNATIONAL FZ LLC'),('GLOBAL PLASTO CHEM'),
    ('HINDUSTAN PETROLEUM CORPORATION LIMITED'),('HRS TRANSPORT'),('INDIAIDEAS.COM'),
    ('INDIAN OIL CORPORATION LIMITED - MH'),('Indian Oil Corporation Limited-GJ'),('JALDEV SHIPPING AGENCY'),
    ('KS Oil Corporation - CR'),('MAYRA PETROLEUM FZCO'),('MSTC LTD'),('Mynd Solutions Pvt. Ltd.'),
    ('NAZPAL OIL ENERGY L.L.C'),('NEW INTERMEDIARY ( BANK OF BARODA )'),
    ('POWER2SME PRIVATE LIMITED(BEBB INDIA PVT LTD)'),('RAAJ UNOCAL LUBRICANTS LTD'),
    ('ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED'),('ROYAL ENTERPRISES'),
    ('SANDEEPDADA THAKUR FOUNDATION'),('SANJIVANI PETROCHEM PRIVATE LIMITED - CR'),
    ('SAYLA ROADLINES'),('SHANTI HEAVY DUTY EARTH MOVERS'),('SHREE HARI ENTERPRISES'),
    ('SIDDHARTH TRADERS'),('SIGMA PETROCHEM'),('SOFTWARES'),('SUKHMANI OIL AND LUBE CRS'),
    ('VIDYAA PETROLEUM INDIA PRIVATE LIMITED - CR')
), matching_heads AS (
    SELECT DISTINCT jh.name
    FROM "JournalHead" jh
    JOIN target_names t ON regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g')
)
INSERT INTO "Agency" (id, name, type, "amountReceivable", "amountPayable", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), h.name, 'BOTH'::"AgencyType", 0, 0, true, now(), now()
FROM matching_heads h
WHERE NOT EXISTS (
    SELECT 1 FROM "Agency" a
    WHERE regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(h.name), '[^a-z0-9]', '', 'g')
);

-- Attach an unassigned journal-head ledger to its matching agency.
-- Existing ledger-to-agency assignments are preserved.
WITH matching AS (
    SELECT DISTINCT jh."ledgerId", a.id AS agency_id
    FROM "JournalHead" jh
    JOIN "Ledger" l ON l.id = jh."ledgerId"
    JOIN "Agency" a ON regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g')
    WHERE l."agencyId" IS NULL
)
UPDATE "Ledger" l
SET "agencyId" = m.agency_id, "updatedAt" = now()
FROM matching m
WHERE l.id = m."ledgerId";

-- Refresh targets so newly created agencies are included and all their ledgers are affected.
TRUNCATE journal_head_agency_repair_targets;
INSERT INTO journal_head_agency_repair_targets
WITH target_names(name) AS (
    SELECT DISTINCT jh.name
    FROM "JournalHead" jh
    WHERE EXISTS (
        SELECT 1 FROM (VALUES
            ('ACCELERATOR GENERAL TRADING LLC'),('AINUMPUDI SURESH VARMA'),('ALOIS BUILDERS AND INF'),
            ('AML MOTORS PVT LTD'),('ANGEL TRADING FZE'),('ARKA PETROCHEM FZC'),('ASPHALTERA PRIVATE LIMITED'),
            ('AVNTIKA ENTERPRISE CRS'),('Additional Collector Raigad Alibag'),('Anjali Electricals'),
            ('Automjet Automobiles Private Limited'),('BHAVESH ENGINEERINGS'),('BYTI HOLIDAYS LLP'),
            ('Bunglow Mahanagar Gas Charges'),('DREAMZZ MAKERS EVENTS AN'),('EKVIRA TRANSPORT AND LOGISTICS'),
            ('EMIT INTERNATIONAL FZ LLC'),('GLOBAL PLASTO CHEM'),('HINDUSTAN PETROLEUM CORPORATION LIMITED'),
            ('HRS TRANSPORT'),('INDIAIDEAS.COM'),('INDIAN OIL CORPORATION LIMITED - MH'),('Indian Oil Corporation Limited-GJ'),
            ('JALDEV SHIPPING AGENCY'),('KS Oil Corporation - CR'),('MAYRA PETROLEUM FZCO'),('MSTC LTD'),
            ('Mynd Solutions Pvt. Ltd.'),('NAZPAL OIL ENERGY L.L.C'),('NEW INTERMEDIARY ( BANK OF BARODA )'),
            ('POWER2SME PRIVATE LIMITED(BEBB INDIA PVT LTD)'),('RAAJ UNOCAL LUBRICANTS LTD'),
            ('ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED'),('ROYAL ENTERPRISES'),('SANDEEPDADA THAKUR FOUNDATION'),
            ('SANJIVANI PETROCHEM PRIVATE LIMITED - CR'),('SAYLA ROADLINES'),('SHANTI HEAVY DUTY EARTH MOVERS'),
            ('SHREE HARI ENTERPRISES'),('SIDDHARTH TRADERS'),('SIGMA PETROCHEM'),('SOFTWARES'),
            ('SUKHMANI OIL AND LUBE CRS'),('VIDYAA PETROLEUM INDIA PRIVATE LIMITED - CR')
        ) n(name)
        WHERE regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(n.name), '[^a-z0-9]', '', 'g')
    )
), matched AS (
    SELECT DISTINCT a.id AS agency_id, a.name AS agency_name, a.type AS current_agency_type,
           l.id AS ledger_id, l.name AS ledger_name, jh.id AS journal_head_id,
           jh.name AS journal_head_name, COUNT(j.id) OVER (PARTITION BY jh.id) AS journal_entry_count
    FROM "JournalHead" jh JOIN "Ledger" l ON l.id = jh."ledgerId"
    JOIN "Agency" a ON a.id = l."agencyId" LEFT JOIN "Journal" j ON j."journalHeadId" = jh.id
    JOIN target_names t ON regexp_replace(lower(jh.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g')
)
SELECT * FROM matched;

BEGIN;

-- Set only matched agencies to BOTH and clear agency-level balances.
UPDATE "Agency" a
SET type = 'BOTH'::"AgencyType",
    "amountReceivable" = 0,
    "amountPayable" = 0,
    "updatedAt" = now()
FROM journal_head_agency_repair_targets t
WHERE a.id = t.agency_id;

-- Link every ledger of each affected agency, including the journal-head ledger.
-- Clear all opening balances for all ledgers owned by those agencies.
UPDATE "Ledger" l
SET "openingBalance" = 0, "openingDebit" = 0, "openingCredit" = 0,
    "openingBalanceDate" = NULL, "updatedAt" = now()
FROM (SELECT DISTINCT agency_id FROM journal_head_agency_repair_targets) t
WHERE l."agencyId" = t.agency_id;

-- Clear opening balances on all branches belonging to matched agencies.
UPDATE "AgencyBranch" ab
SET "openingBalance" = 0,
    "updatedAt" = now()
FROM journal_head_agency_repair_targets t
WHERE ab."agencyId" = t.agency_id;

-- Clear ledger opening balances, then rebuild currentBalance from entries.
UPDATE "Ledger" l
SET "openingBalance" = 0,
    "openingDebit" = 0,
    "openingCredit" = 0,
    "openingBalanceDate" = NULL,
    "updatedAt" = now()
FROM journal_head_agency_repair_targets t
WHERE l.id = t.ledger_id;

WITH balances AS (
    SELECT l.id,
           COALESCE(SUM(CASE WHEN le."entryType" = 'DEBIT'::"EntryType"
                             THEN le.amount ELSE -le.amount END), 0) AS balance
    FROM "Ledger" l
    JOIN (SELECT DISTINCT agency_id FROM journal_head_agency_repair_targets) t ON l."agencyId" = t.agency_id
    LEFT JOIN "LedgerEntry" le ON le."ledgerId" = l.id
    GROUP BY l.id
)
UPDATE "Ledger" l
SET "currentBalance" = b.balance,
    "updatedAt" = now()
FROM balances b
WHERE l.id = b.id;

COMMIT;

DROP TABLE IF EXISTS journal_head_agency_repair_targets;
