-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "buyerOrderDate" TIMESTAMP(3),
ADD COLUMN     "buyerOrderNo" TEXT,
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "despatchDocDate" TIMESTAMP(3),
ADD COLUMN     "despatchDocNo" TEXT,
ADD COLUMN     "despatchThrough" TEXT,
ADD COLUMN     "destination" TEXT,
ADD COLUMN     "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "otherReference" TEXT,
ADD COLUMN     "suppliersRef" TEXT;
