import { ProductUnit } from "@prisma/client";
import { prisma } from "../config/db";
import { InventoryService } from "../modules/inventory/inventory.service";
import { ProductLedgerService } from "../modules/accounting/productLedger/productLedger.service";

/**
 * Supplies opening stock for the two SCRAP DRUMS sales imported from
 * saleerrorlatest3.0.xlsx. Run this after the sale import and before retrying
 * approval for the invoices.
 *
 * The importer initially assigns an empty fallback batch when stock is absent.
 * This seed adds stock to that same batch, so the pending sale keeps its FIFO
 * allocation and can be approved without editing its sale items.
 *
 * If run before the sale import, it creates a normal opening batch with the
 * combined 2,000 KG required by the two invoices.
 */

const PRODUCT_ID = "6b24522a-735f-4e5d-8416-c8c681ebf64b";
const INVOICES = ["APM/G2526/2332", "APM/G2526/3078"];
const FALLBACK_QUANTITY_KG = 2_000;
const SEED_REFERENCE_PREFIX = "SEED_SCRAP_DRUMS_SALE_IMPORT_2026";

async function main() {
    const product = await prisma.product.findUnique({
        where: { id: PRODUCT_ID }
    });

    if (!product) {
        throw new Error(`SCRAP DRUMS product ${PRODUCT_ID} was not found.`);
    }

    const sales = await prisma.sale.findMany({
        where: {
            invoiceNo: { in: INVOICES },
            status: "PENDING"
        },
        include: {
            items: {
                where: { productId: PRODUCT_ID },
                select: {
                    batchId: true,
                    quantity: true,
                    unit: true
                }
            }
        }
    });

    const allocations = new Map<string, { branchId: string; quantityKG: number; date: Date }>();

    for (const sale of sales) {
        for (const item of sale.items) {
            if (item.unit !== ProductUnit.KG && item.unit !== ProductUnit.MT) {
                throw new Error(
                    `Invoice ${sale.invoiceNo} uses ${item.unit}; this seed only supports KG/MT stock.`
                );
            }

            const quantityKG = Number(item.quantity) * (item.unit === ProductUnit.MT ? 1000 : 1);
            const existing = allocations.get(item.batchId);

            allocations.set(item.batchId, {
                branchId: sale.branchId,
                quantityKG: Number(((existing?.quantityKG || 0) + quantityKG).toFixed(3)),
                date: sale.invoiceDate,
            });
        }
    }

    if (allocations.size === 0) {
        const branch = await prisma.branch.findFirst({ where: { isActive: true } });
        if (!branch) throw new Error("No active branch found for the opening stock batch.");

        const batchNo = "SCRAP-DRUMS-OPENING-2026-01";
        const batch = await prisma.inventoryBatch.findUnique({
            where: {
                branchId_productId_batchNo: {
                    branchId: branch.id,
                    productId: PRODUCT_ID,
                    batchNo
                }
            }
        });

        if (batch) {
            allocations.set(batch.id, {
                branchId: branch.id,
                quantityKG: FALLBACK_QUANTITY_KG,
                date: new Date("2026-01-01T00:00:00.000Z")
            });
        } else {
            await prisma.$transaction(async tx => {
                const created = await InventoryService.addStock(tx, {
                    branchId: branch.id,
                    productId: PRODUCT_ID,
                    batchNo,
                    quantity: FALLBACK_QUANTITY_KG,
                    unit: ProductUnit.KG,
                    purchasePrice: 0,
                    transactionDate: new Date("2026-01-01T00:00:00.000Z")
                });

                const ledger = await ProductLedgerService.getOrCreateProductLedger(PRODUCT_ID, tx);
                await tx.productLedgerEntry.create({
                    data: {
                        productLedgerId: ledger.id,
                        movementType: "OPENING_BALANCE",
                        direction: "CREDIT",
                        quantityKG: FALLBACK_QUANTITY_KG,
                        quantityLTR: 0,
                        unit: ProductUnit.KG,
                        branchId: branch.id,
                        batchId: created.id,
                        batchNo,
                        invoiceNo: "OPENING STOCK",
                        unitCost: 0,
                        totalCost: 0,
                        entryDate: new Date("2026-01-01T00:00:00.000Z"),
                        reference: `${SEED_REFERENCE_PREFIX}:${batchNo}`,
                        remarks: "Opening stock for APM/G2526/2332 and APM/G2526/3078"
                    }
                });
                await tx.product.update({
                    where: { id: PRODUCT_ID },
                    data: { openingStockKG: { increment: FALLBACK_QUANTITY_KG } }
                });
            });
            console.log(`Created ${FALLBACK_QUANTITY_KG} KG opening stock in ${batchNo}.`);
            return;
        }
    }

    let seededQuantity = 0;
    for (const [batchId, allocation] of allocations) {
        const reference = `${SEED_REFERENCE_PREFIX}:${batchId}`;
        const alreadySeeded = await prisma.productLedgerEntry.findFirst({
            where: { reference }
        });

        if (alreadySeeded) {
            console.log(`Skipped batch ${batchId}: stock seed already exists.`);
            continue;
        }

        await prisma.$transaction(async tx => {
            const batch = await tx.inventoryBatch.findUnique({ where: { id: batchId } });
            if (!batch) throw new Error(`Allocated inventory batch ${batchId} was not found.`);

            await InventoryService.addStock(tx, {
                branchId: allocation.branchId,
                productId: PRODUCT_ID,
                batchNo: batch.batchNo,
                quantity: allocation.quantityKG,
                unit: ProductUnit.KG,
                purchasePrice: 0,
                transactionDate: allocation.date
            });

            const ledger = await ProductLedgerService.getOrCreateProductLedger(PRODUCT_ID, tx);
            await tx.productLedgerEntry.create({
                data: {
                    productLedgerId: ledger.id,
                    movementType: "OPENING_BALANCE",
                    direction: "CREDIT",
                    quantityKG: allocation.quantityKG,
                    quantityLTR: 0,
                    unit: ProductUnit.KG,
                    branchId: allocation.branchId,
                    batchId,
                    batchNo: batch.batchNo,
                    invoiceNo: "OPENING STOCK",
                    unitCost: 0,
                    totalCost: 0,
                    entryDate: allocation.date,
                    reference,
                    remarks: `Opening stock for pending scrap-drum sale import (${INVOICES.join(", ")})`
                }
            });
            await tx.product.update({
                where: { id: PRODUCT_ID },
                data: { openingStockKG: { increment: allocation.quantityKG } }
            });
        });

        seededQuantity += allocation.quantityKG;
        console.log(`Seeded ${allocation.quantityKG} KG into batch ${batchId}.`);
    }

    console.log(`Completed. Seeded ${seededQuantity} KG for ${sales.length} pending sale(s).`);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
