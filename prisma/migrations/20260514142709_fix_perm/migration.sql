-- DropIndex
DROP INDEX "Permission_module_key";

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");
