CREATE TYPE "ProductType" AS ENUM ('PURCHASED', 'MANUFACTURED', 'BOTH');
ALTER TABLE "Product" ADD COLUMN "productType" "ProductType" NOT NULL DEFAULT 'PURCHASED';

ALTER TYPE "ProductMovementType" ADD VALUE IF NOT EXISTS 'MANUFACTURE_IN';
ALTER TYPE "ProductMovementType" ADD VALUE IF NOT EXISTS 'MANUFACTURE_OUT';

CREATE TYPE "ProductRecipeStatus" AS ENUM ('DRAFT', 'APPROVED', 'LOCKED', 'REJECTED');
CREATE TYPE "ProductManufactureStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

CREATE TABLE "ProductRecipe" (
  "id" TEXT NOT NULL,
  "outputProductId" TEXT NOT NULL,
  "outputQuantity" DECIMAL(18,3) NOT NULL,
  "outputUnit" "ProductUnit" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "remarks" TEXT,
  "status" "ProductRecipeStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductRecipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRecipeItem" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unit" "ProductUnit" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductRecipeItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductManufacture" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "outputProductId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "outputBatchId" TEXT,
  "outputBatchNo" TEXT NOT NULL,
  "outputQuantity" DECIMAL(18,3) NOT NULL,
  "outputUnit" "ProductUnit" NOT NULL,
  "totalManufacturingCost" DECIMAL(18,2),
  "unitManufacturingCost" DECIMAL(18,2),
  "remarks" TEXT,
  "status" "ProductManufactureStatus" NOT NULL DEFAULT 'DRAFT',
  "voucherId" TEXT,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductManufacture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductManufactureConsumption" (
  "id" TEXT NOT NULL,
  "manufactureId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unit" "ProductUnit" NOT NULL,
  "unitCost" DECIMAL(18,2) NOT NULL,
  "totalCost" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductManufactureConsumption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductRecipeItem_recipeId_productId_key" ON "ProductRecipeItem"("recipeId", "productId");
CREATE INDEX "ProductRecipe_outputProductId_idx" ON "ProductRecipe"("outputProductId");
CREATE INDEX "ProductRecipe_status_idx" ON "ProductRecipe"("status");
CREATE INDEX "ProductRecipeItem_productId_idx" ON "ProductRecipeItem"("productId");
CREATE INDEX "ProductManufacture_recipeId_idx" ON "ProductManufacture"("recipeId");
CREATE INDEX "ProductManufacture_branchId_status_idx" ON "ProductManufacture"("branchId", "status");
CREATE INDEX "ProductManufacture_outputProductId_idx" ON "ProductManufacture"("outputProductId");
CREATE INDEX "ProductManufactureConsumption_manufactureId_idx" ON "ProductManufactureConsumption"("manufactureId");
CREATE INDEX "ProductManufactureConsumption_productId_batchId_idx" ON "ProductManufactureConsumption"("productId", "batchId");
CREATE UNIQUE INDEX "ProductRecipe_one_approved_per_product_key" ON "ProductRecipe"("outputProductId") WHERE "status" = 'APPROVED';

ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductRecipeItem" ADD CONSTRAINT "ProductRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRecipeItem" ADD CONSTRAINT "ProductRecipeItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_outputBatchId_fkey" FOREIGN KEY ("outputBatchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductManufacture" ADD CONSTRAINT "ProductManufacture_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductManufactureConsumption" ADD CONSTRAINT "ProductManufactureConsumption_manufactureId_fkey" FOREIGN KEY ("manufactureId") REFERENCES "ProductManufacture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductManufactureConsumption" ADD CONSTRAINT "ProductManufactureConsumption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductManufactureConsumption" ADD CONSTRAINT "ProductManufactureConsumption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
