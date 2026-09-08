ALTER TABLE "Journal"
ADD COLUMN IF NOT EXISTS "agencyId" TEXT;

CREATE INDEX IF NOT EXISTS "Journal_agencyId_idx"
ON "Journal"("agencyId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Journal_agencyId_fkey'
    ) THEN
        ALTER TABLE "Journal"
        ADD CONSTRAINT "Journal_agencyId_fkey"
        FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
