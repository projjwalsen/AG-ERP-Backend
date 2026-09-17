CREATE TABLE IF NOT EXISTS "JournalCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JournalCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JournalCategory_name_key"
ON "JournalCategory"("name");

CREATE INDEX IF NOT EXISTS "JournalCategory_isActive_idx"
ON "JournalCategory"("isActive");

CREATE INDEX IF NOT EXISTS "JournalCategory_name_idx"
ON "JournalCategory"("name");

ALTER TABLE "Journal"
ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

CREATE INDEX IF NOT EXISTS "Journal_categoryId_idx"
ON "Journal"("categoryId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Journal_categoryId_fkey'
    ) THEN
        ALTER TABLE "Journal"
        ADD CONSTRAINT "Journal_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "JournalCategory"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
