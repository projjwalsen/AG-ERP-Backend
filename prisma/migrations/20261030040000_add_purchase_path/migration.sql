ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "path" TEXT;
CREATE INDEX IF NOT EXISTS "Purchase_path_idx" ON "Purchase"("path");
