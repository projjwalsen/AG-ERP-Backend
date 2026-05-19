-- CreateEnum
CREATE TYPE "AgencyType" AS ENUM ('VENDOR', 'CLIENT', 'BOTH');

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AgencyType" NOT NULL,
    "gstin" TEXT,
    "contactPerson" TEXT,
    "mobileNumber" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pinCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyBranch" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "openingBalance" DECIMAL(18,3) NOT NULL DEFAULT 0.00,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyBranch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_gstin_key" ON "Agency"("gstin");

-- CreateIndex
CREATE INDEX "Agency_name_idx" ON "Agency"("name");

-- CreateIndex
CREATE INDEX "Agency_gstin_idx" ON "Agency"("gstin");

-- CreateIndex
CREATE INDEX "Agency_type_idx" ON "Agency"("type");

-- CreateIndex
CREATE INDEX "AgencyBranch_agencyId_idx" ON "AgencyBranch"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyBranch_branchId_idx" ON "AgencyBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyBranch_agencyId_branchId_key" ON "AgencyBranch"("agencyId", "branchId");

-- AddForeignKey
ALTER TABLE "AgencyBranch" ADD CONSTRAINT "AgencyBranch_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBranch" ADD CONSTRAINT "AgencyBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
