/*
  Warnings:

  - You are about to drop the column `pricePerUnit` on the `Product` table. All the data in the column will be lost.
  - Added the required column `sellPricePerUnit` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "pricePerUnit",
ADD COLUMN     "applicableGST" DECIMAL(5,2),
ADD COLUMN     "hsnNo" TEXT,
ADD COLUMN     "sellPricePerUnit" DECIMAL(18,2) NOT NULL;

-- CreateIndex
CREATE INDEX "Product_hsnNo_idx" ON "Product"("hsnNo");
