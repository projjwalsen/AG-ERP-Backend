/*
  Warnings:

  - You are about to drop the column `masterId` on the `Branch` table. All the data in the column will be lost.
  - You are about to drop the column `masterId` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `isOtpVerified` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `masterId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resetOtp` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resetOtpExpiry` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Master` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[code]` on the table `Branch` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code]` on the table `Role` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Branch" DROP CONSTRAINT "Branch_masterId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_masterId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_masterId_fkey";

-- DropIndex
DROP INDEX "Branch_masterId_code_key";

-- DropIndex
DROP INDEX "Branch_masterId_idx";

-- DropIndex
DROP INDEX "Role_masterId_code_key";

-- DropIndex
DROP INDEX "Role_masterId_idx";

-- DropIndex
DROP INDEX "User_masterId_idx";

-- AlterTable
ALTER TABLE "Branch" DROP COLUMN "masterId";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "masterId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isOtpVerified",
DROP COLUMN "masterId",
DROP COLUMN "resetOtp",
DROP COLUMN "resetOtpExpiry";

-- DropTable
DROP TABLE "Master";

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");
