/**
 * ========================================
 * BACKFILL PRODUCT LEDGER FROM APPROVED TRANSACTIONS
 * ========================================
 * 
 * Seeds ProductLedger and ProductLedgerEntry from all APPROVED
 * purchases and sales for a specific product
 * 
 * Usage:
 * npx ts-node src/scripts/seed-product-ledger-from-approved.ts
 */

import { prisma } from "../config/db";
import { ProductMovementType, ProductMovementDirection } from "@prisma/client";

const PRODUCT_ID = "e019e0a4-b989-4270-a944-ded324f3408d";

interface LedgerEntry {
    id: string;
    movementType: string;
    quantityKG: number;
    invoiceNo: string;
    direction: string;
    entryDate: Date;
}

async function main() {
    console.log("🌱 Backfilling ProductLedger from APPROVED transactions...\n");

    try {
        // Step 1: Get product
        const product = await prisma.product.findUnique({
            where: { id: PRODUCT_ID },
        });

        if (!product) {
            throw new Error(`❌ Product not found with ID: ${PRODUCT_ID}`);
        }

        console.log(`✅ Found product: ${product.name} (${product.sku})`);
        console.log(`   SKU: ${product.sku}\n`);

        // Step 2: Create ProductLedger if doesn't exist
        let ledger = await prisma.productLedger.findUnique({
            where: { productId: PRODUCT_ID },
        });

        if (!ledger) {
            ledger = await prisma.productLedger.create({
                data: {
                    code: `PL-${PRODUCT_ID.substring(0, 8)}`,
                    product: {
                        connect: { id: PRODUCT_ID }
                    }
                },
            });
            console.log(`✅ Created new ProductLedger: ${ledger.id}\n`);
        } else {
            console.log(`✅ Using existing ProductLedger: ${ledger.id}\n`);
        }

        // Step 3: Delete existing entries (for clean backfill)
        const deletedCount = await prisma.productLedgerEntry.deleteMany({
            where: { productLedgerId: ledger.id },
        });

        if (deletedCount.count > 0) {
            console.log(`🗑️  Deleted ${deletedCount.count} existing entries\n`);
        }

        // Step 4: Get all APPROVED purchases for this product
        console.log("📦 Processing APPROVED purchases...\n");

        const purchases = await prisma.purchase.findMany({
            where: { status: "APPROVED" },
            include: {
                items: {
                    where: { productId: PRODUCT_ID },
                    include: {
                        batch: true
                    }
                },
                branch: true,
            },
            orderBy: { createdAt: "asc" }
        });

        const purchaseEntries: LedgerEntry[] = [];
        let purchaseCount = 0;

        for (const purchase of purchases) {
            // Skip if no items for this product
            if (purchase.items.length === 0) continue;

            try {
                for (const item of purchase.items) {
                    // Ensure batch exists
                    let batch = item.batch;
                    if (!batch) {
                        batch = await prisma.inventoryBatch.findFirst({
                            where: {
                                productId: PRODUCT_ID,
                                batchNo: item.batchNo,
                            }
                        });
                    }

                    if (!batch) {
                        // Create batch if doesn't exist
                        batch = await prisma.inventoryBatch.create({
                            data: {
                                batchNo: item.batchNo,
                                purchasePrice: 0,
                                product: {
                                    connect: { id: PRODUCT_ID }
                                },
                                branch: {
                                    connect: { id: purchase.branchId }
                                }
                            }
                        });
                    }

                    // Create ProductLedgerEntry
                    const entry = await prisma.productLedgerEntry.create({
                        data: {
                            productLedgerId: ledger.id,
                            movementType: ProductMovementType.PURCHASE,
                            direction: ProductMovementDirection.CREDIT,
                            quantityKG: Number(item.quantity),
                            quantityLTR: null,
                            unit: "KG",
                            branchId: purchase.branchId,
                            agencyId: purchase.agencyId,
                            purchaseId: purchase.id,
                            saleId: null,
                            batchId: batch.id,
                            batchNo: batch.batchNo,
                            invoiceNo: purchase.invoiceNo,
                            unitCost: item.purchasePrice ? Number(item.purchasePrice) : null,
                            totalCost: item.purchasePrice ? (Number(item.purchasePrice) * Number(item.quantity)) : null,
                            entryDate: purchase.approvedAt || purchase.createdAt,
                            remarks: `Backfilled from purchase ${purchase.invoiceNo}`,
                            createdById: purchase.approvedById || purchase.createdById
                        }
                    });

                    purchaseEntries.push({
                        id: entry.id,
                        movementType: "PURCHASE",
                        quantityKG: Number(entry.quantityKG || 0),
                        invoiceNo: entry.invoiceNo || "",
                        direction: entry.direction,
                        entryDate: entry.entryDate
                    });

                    purchaseCount++;
                }
            } catch (error: any) {
                console.log(`⚠️  Purchase ${purchase.invoiceNo}: ${error.message}`);
            }
        }

        console.log(`✅ Created ${purchaseCount} PURCHASE entries from ${purchases.filter(p => p.items.length > 0).length} approved purchases\n`);

        // Step 5: Get all APPROVED sales for this product
        console.log("🛒 Processing APPROVED sales...\n");

        const sales = await prisma.sale.findMany({
            where: { status: "APPROVED" },
            include: {
                items: {
                    where: { productId: PRODUCT_ID },
                    include: {
                        batch: true
                    }
                },
                branch: true,
            },
            orderBy: { createdAt: "asc" }
        });

        const saleEntries: LedgerEntry[] = [];
        let saleCount = 0;

        for (const sale of sales) {
            // Skip if no items for this product
            if (sale.items.length === 0) continue;

            try {
                for (const item of sale.items) {
                    if (!item.batch) {
                        console.log(`⚠️  Sale ${sale.invoiceNo}: Item missing batch, skipping`);
                        continue;
                    }

                    // Create ProductLedgerEntry with FIFO batch link
                    const entry = await prisma.productLedgerEntry.create({
                        data: {
                            productLedgerId: ledger.id,
                            movementType: ProductMovementType.SALE,
                            direction: ProductMovementDirection.DEBIT,
                            quantityKG: Number(item.quantity),
                            quantityLTR: null,
                            unit: "KG",
                            branchId: sale.branchId,
                            agencyId: sale.agencyId,
                            purchaseId: null,
                            saleId: sale.id,
                            batchId: item.batchId,           // FIFO link
                            batchNo: item.batch.batchNo,    // FIFO link
                            invoiceNo: sale.invoiceNo,
                            unitCost: null,
                            totalCost: null,
                            entryDate: sale.invoiceDate || sale.approvedAt || sale.createdAt,
                            remarks: `Backfilled from sale ${sale.invoiceNo}`,
                            createdById: sale.approvedById || sale.createdById
                        }
                    });

                    saleEntries.push({
                        id: entry.id,
                        movementType: "SALE",
                        quantityKG: Number(entry.quantityKG || 0),
                        invoiceNo: entry.invoiceNo || "",
                        direction: entry.direction,
                        entryDate: entry.entryDate
                    });

                    saleCount++;
                }
            } catch (error: any) {
                console.log(`⚠️  Sale ${sale.invoiceNo}: ${error.message}`);
            }
        }

        console.log(`✅ Created ${saleCount} SALE entries from ${sales.filter(s => s.items.length > 0).length} approved sales\n`);

        // Step 6: Combine and sort all entries by date
        const allEntries = [...purchaseEntries, ...saleEntries].sort(
            (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
        );

        // Step 7: Calculate and display running balance
        console.log("📈 Running Balance Calculation:");
        console.log("════════════════════════════════════════════════════════════════════\n");

        let balance = 0;
        allEntries.forEach((entry, index) => {
            const quantity =
                entry.direction === ProductMovementDirection.CREDIT
                    ? entry.quantityKG
                    : -entry.quantityKG;

            balance += quantity;

            const type = entry.movementType.padEnd(8);
            const qty = entry.quantityKG.toString().padEnd(8);
            const invoice = entry.invoiceNo.padEnd(15);
            const date = new Date(entry.entryDate).toISOString().split("T")[0];

            console.log(
                `${(index + 1).toString().padEnd(3)}. ${type} | ${qty} KG | ${invoice} | ${date} | Balance: ${balance} KG`
            );
        });

        console.log("\n════════════════════════════════════════════════════════════════════");
        console.log(`✅ Final Balance: ${balance} KG\n`);

        // Step 8: Show Summary
        console.log("📊 Summary:");
        console.log(`   Total Entries Created: ${allEntries.length}`);
        console.log(`   - PURCHASE entries: ${purchaseCount}`);
        console.log(`   - SALE entries: ${saleCount}`);
        console.log(`   Final Stock Balance: ${balance} KG\n`);

        // Step 9: Show Inventory status
        const inventory = await prisma.inventory.findFirst({
            where: { productId: PRODUCT_ID },
        });

        console.log("📦 Current Inventory Status:");
        if (inventory) {
            console.log(`   Current Stock: ${inventory.currentStockKG} KG`);
            console.log(`   Last Updated: ${inventory.lastUpdated}\n`);
        } else {
            console.log("   No inventory record found\n");
        }

        // Step 10: Test endpoints
        console.log("🧪 Test these endpoints:\n");
        console.log(`curl "http://localhost:3000/api/product-ledger/${PRODUCT_ID}/detail"`);
        console.log(`   → Shows product info + paginated movements\n`);

        console.log(`curl "http://localhost:3000/api/product-ledger/${PRODUCT_ID}/full-history"`);
        console.log(`   → Shows all movements with running balance\n`);

        console.log(`curl "http://localhost:3000/api/product-ledger/${PRODUCT_ID}/stock"`);
        console.log(`   → Shows current global stock\n`);

        console.log("✨ Backfill completed successfully!\n");

    } catch (error) {
        console.error("❌ Error during backfill:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
