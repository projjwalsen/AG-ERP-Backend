import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 16000,
    timeout: 20000,
  },
});

async function main() {
  console.log("🌱 Starting database seed...");

  try {
    // Get all agencies
    const agencies = await prisma.agency.findMany({
      select: { id: true, name: true },
    });

    console.log(`📊 Processing ${agencies.length} agencies...`);

    for (const agency of agencies) {
      // Calculate amountReceivable (outstanding from customers - APPROVED sales)
      const salesResult = await prisma.sale.aggregate({
        where: {
          agencyId: agency.id,
          status: "APPROVED",
        },
        _sum: {
          grandTotal: true,
        },
      });

      const totalSalesAmount = salesResult._sum.grandTotal
        ? Number(salesResult._sum.grandTotal)
        : 0;

      // Calculate allocations already paid against sales
      const salesAllocations = await prisma.transactionAllocation.aggregate({
        where: {
          sale: {
            agencyId: agency.id,
            status: "APPROVED",
          },
        },
        _sum: {
          allocatedAmount: true,
        },
      });

      const totalSalesAllocated = salesAllocations._sum.allocatedAmount
        ? Number(salesAllocations._sum.allocatedAmount)
        : 0;

      const amountReceivable = totalSalesAmount - totalSalesAllocated;

      // Calculate amountDue (outstanding to vendors - APPROVED purchases)
      const purchasesResult = await prisma.purchase.aggregate({
        where: {
          agencyId: agency.id,
          status: "APPROVED",
        },
        _sum: {
          grandTotal: true,
        },
      });

      const totalPurchasesAmount = purchasesResult._sum.grandTotal
        ? Number(purchasesResult._sum.grandTotal)
        : 0;

      // Calculate allocations already paid against purchases
      const purchaseAllocations = await prisma.transactionAllocation.aggregate({
        where: {
          purchase: {
            agencyId: agency.id,
            status: "APPROVED",
          },
        },
        _sum: {
          allocatedAmount: true,
        },
      });

      const totalPurchasesAllocated = purchaseAllocations._sum.allocatedAmount
        ? Number(purchaseAllocations._sum.allocatedAmount)
        : 0;

      const amountDue = totalPurchasesAmount - totalPurchasesAllocated;

      // Update agency with calculated balances
      await prisma.agency.update({
        where: { id: agency.id },
        data: {
          amountReceivable: new Prisma.Decimal(
            Math.max(0, amountReceivable)
          ),
          amountDue: new Prisma.Decimal(
            Math.max(0, amountDue)
          ),
        },
      });

      console.log(
        `✅ ${agency.name} | Receivable: ${amountReceivable.toFixed(2)} | Due: ${amountDue.toFixed(2)}`
      );
    }

    console.log("✨ Seed completed successfully!");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
