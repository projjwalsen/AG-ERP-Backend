import { ProductMovementType } from "@prisma/client";
import { prisma } from "./src/config/db";

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
    const openings = await prisma.productLedgerEntry.findMany({
        where: { movementType: ProductMovementType.OPENING_BALANCE },
        select: {
            quantityKG: true,
            unitCost: true,
            totalCost: true,
            productLedger: { select: { product: { select: { name: true } } } }
        }
    });
    const byName = new Map<string, { qty: number; cost: number; unitCost: number | null }>();
    for (const row of openings) {
        const name = row.productLedger.product.name;
        const cur = byName.get(name) || { qty: 0, cost: 0, unitCost: null };
        cur.qty += Number(row.quantityKG || 0);
        cur.cost += Number(row.totalCost || 0);
        if (row.unitCost != null) cur.unitCost = Number(row.unitCost);
        byName.set(name, cur);
    }
    const totalCost = money([...byName.values()].reduce((s, r) => s + r.cost, 0));
    const withCost = [...byName.values()].filter(r => r.cost).length;
    console.log(JSON.stringify({
        openingEntries: openings.length,
        productsWithOpeningEntry: byName.size,
        productsWithTotalCost: withCost,
        sumTotalCost: totalCost
    }, null, 2));

    const batches = await prisma.inventoryBatch.findMany({
        select: { availableQtyKG: true, purchasePrice: true, product: { select: { name: true, openingStockKG: true } } }
    });
    // not current stock - skip
    const ledger = await prisma.ledger.findMany({
        where: { name: { equals: "Opening Stock", mode: "insensitive" } },
        select: { id: true, name: true, openingDebit: true, openingCredit: true, currentBalance: true, group: { select: { name: true } } }
    });
    console.log("opening stock ledgers", ledger);
}

main().finally(() => prisma.$disconnect());
