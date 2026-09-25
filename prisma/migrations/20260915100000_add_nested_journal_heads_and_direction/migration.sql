DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JournalHeadKind') THEN
        CREATE TYPE "JournalHeadKind" AS ENUM ('PARENT', 'SUBHEAD');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JournalDirection') THEN
        CREATE TYPE "JournalDirection" AS ENUM ('INWARD', 'OUTWARD');
    END IF;
END $$;

ALTER TABLE "JournalHead"
ADD COLUMN IF NOT EXISTS "headType" "JournalHeadKind" NOT NULL DEFAULT 'PARENT',
ADD COLUMN IF NOT EXISTS "parentId" TEXT;

ALTER TABLE "JournalHead"
ALTER COLUMN "type" DROP NOT NULL;

ALTER TABLE "Journal"
ADD COLUMN IF NOT EXISTS "direction" "JournalDirection";

UPDATE "Journal" j
SET "direction" = CASE
    WHEN h."type" = 'INWARD' THEN 'INWARD'::"JournalDirection"
    ELSE 'OUTWARD'::"JournalDirection"
END
FROM "JournalHead" h
WHERE j."journalHeadId" = h."id"
  AND j."direction" IS NULL;

CREATE INDEX IF NOT EXISTS "JournalHead_parentId_idx"
ON "JournalHead"("parentId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'JournalHead_parentId_fkey'
    ) THEN
        ALTER TABLE "JournalHead"
        ADD CONSTRAINT "JournalHead_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "JournalHead"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
