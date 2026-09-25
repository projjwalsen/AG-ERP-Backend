DROP INDEX IF EXISTS "JournalCategory_name_key";
CREATE INDEX IF NOT EXISTS "JournalCategory_name_idx" ON "JournalCategory"("name");
