-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "allowNegativeInventory" BOOLEAN NOT NULL DEFAULT false,
    "allowNegativeTransaction" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);
