/*
  Warnings:

  - You are about to drop the column `companyId` on the `Branch` table. All the data in the column will be lost.
  - You are about to drop the column `companyId` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `companyId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Company` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserBranch` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[masterId,code]` on the table `Branch` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[masterId,code]` on the table `Role` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `masterId` to the `Branch` table without a default value. This is not possible if the table is not empty.
  - Added the required column `masterId` to the `Role` table without a default value. This is not possible if the table is not empty.
  - Added the required column `masterId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Branch" DROP CONSTRAINT "Branch_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_companyId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_companyId_fkey";

-- DropForeignKey
ALTER TABLE "UserBranch" DROP CONSTRAINT "UserBranch_branchId_fkey";

-- DropForeignKey
ALTER TABLE "UserBranch" DROP CONSTRAINT "UserBranch_userId_fkey";

-- DropIndex
DROP INDEX "Branch_companyId_code_key";

-- DropIndex
DROP INDEX "Branch_companyId_idx";

-- DropIndex
DROP INDEX "Role_companyId_code_key";

-- DropIndex
DROP INDEX "Role_companyId_idx";

-- DropIndex
DROP INDEX "User_companyId_idx";

-- AlterTable
ALTER TABLE "Branch" DROP COLUMN "companyId",
ADD COLUMN     "masterId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "companyId",
ADD COLUMN     "masterId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "companyId",
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "masterId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Company";

-- DropTable
DROP TABLE "UserBranch";

-- CreateTable
CREATE TABLE "Master" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pinCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Master_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Branch_masterId_idx" ON "Branch"("masterId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_masterId_code_key" ON "Branch"("masterId", "code");

-- CreateIndex
CREATE INDEX "Role_masterId_idx" ON "Role"("masterId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_masterId_code_key" ON "Role"("masterId", "code");

-- CreateIndex
CREATE INDEX "User_masterId_idx" ON "User"("masterId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "Master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "Master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "Master"("id") ON DELETE CASCADE ON UPDATE CASCADE;
