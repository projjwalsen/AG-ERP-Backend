-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOtpVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resetOtp" TEXT,
ADD COLUMN     "resetOtpExpiry" TIMESTAMP(3);
