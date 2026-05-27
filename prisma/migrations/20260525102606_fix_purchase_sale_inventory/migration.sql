/*
  Warnings:

  - You are about to drop the column `quantityKG` on the `PurchaseItem` table. All the data in the column will be lost.
  - You are about to drop the column `quantityLTR` on the `PurchaseItem` table. All the data in the column will be lost.
  - You are about to drop the column `quantityKG` on the `SalesItem` table. All the data in the column will be lost.
  - You are about to drop the column `quantityLTR` on the `SalesItem` table. All the data in the column will be lost.
  - Added the required column `quantity` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unit` to the `PurchaseItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantity` to the `SalesItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unit` to the `SalesItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PurchaseItem" DROP COLUMN "quantityKG",
DROP COLUMN "quantityLTR",
ADD COLUMN     "quantity" DECIMAL(18,3) NOT NULL,
ADD COLUMN     "unit" "ProductUnit" NOT NULL;

-- AlterTable
ALTER TABLE "SalesItem" DROP COLUMN "quantityKG",
DROP COLUMN "quantityLTR",
ADD COLUMN     "quantity" DECIMAL(18,3) NOT NULL,
ADD COLUMN     "unit" "ProductUnit" NOT NULL;
