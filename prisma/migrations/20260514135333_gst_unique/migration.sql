/*
  Warnings:

  - A unique constraint covering the columns `[gstin]` on the table `Branch` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Branch_gstin_key" ON "Branch"("gstin");
