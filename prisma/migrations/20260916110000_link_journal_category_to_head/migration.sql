ALTER TABLE "JournalCategory"
ADD COLUMN IF NOT EXISTS "journalHeadId" TEXT;

CREATE INDEX IF NOT EXISTS "JournalCategory_journalHeadId_idx"
ON "JournalCategory"("journalHeadId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'JournalCategory_journalHeadId_fkey'
    ) THEN
        ALTER TABLE "JournalCategory"
        ADD CONSTRAINT "JournalCategory_journalHeadId_fkey"
        FOREIGN KEY ("journalHeadId") REFERENCES "JournalHead"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
