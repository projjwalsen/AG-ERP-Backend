/**
 * ========================================
 * SEED PRODUCT LEDGER
 * ========================================
 * 
 * Seeds ProductLedger and ProductLedgerEntry for testing
 * 
 * Usage:
 * npx ts-node src/scripts/seed-product-ledger.ts
 */

import { prisma } from "../config/db";
import { ProductMovementType, ProductMovementDirection } from "@prisma/client";

const PRODUCT_ID = "057d3f04-ff5c-4e59-8b10-a49146ac5ad6";

async function main() {
    console.log("🌱 Seeding ProductLedger and ProductLedgerEntry...\n");

    try {
        // Step 1: Get product
        const product = await prisma.product.findUnique({
            where: { id: PRODUCT_ID },
        });

        if (!product) {
            throw new Error(`❌ Product not found with ID: ${PRODUCT_ID}`);
        }

        console.log(`✅ Found product: ${product.name} (${product.code})`);
        console.log(`   Unit: ${product.unit}\n`);

        // Step 2: Create ProductLedger
        const ledger = await prisma.productLedger.upsert({
            where: { productId: PRODUCT_ID },
            update: {},
            create: {
                productId: PRODUCT_ID,
            },
        });

        console.log(`✅ ProductLedger created/updated: ${ledger.id}\n`);

        // Step 3: Delete existing entries (for clean seed)
        const deletedCount = await prisma.productLedgerEntry.deleteMany({
            where: { productLedgerId: ledger.id },
        });

        if (deletedCount.count > 0) {
            console.log(`🗑️  Deleted ${deletedCount.count} existing entries\n`);
        }

        // Step 4: Get or create a default branch
        let branch = await prisma.branch.findFirst();
        if (!branch) {
            branch = await prisma.branch.create({
                data: {
                    name: "Default Branch",
                    city: "Default City",
                },
            });
            console.log(`✅ Created default branch: ${branch.name}\n`);
        }

        // Step 5: Create seed entries
        const entries = [];

        // ENTRY 1: OPENING BALANCE (1000 KG)
        const entry1 = await prisma.productLedgerEntry.create({
            data: {
                productLedgerId: ledger.id,
                movementType: ProductMovementType.OPENING_BALANCE,
                direction: ProductMovementDirection.INBOUND,
                quantityKG: 1000,
                quantityLTR: null,
                unit: product.unit,
                branchId: branch.id,
                agencyId: null,
                purchaseId: null,
                saleId: null,
                batchId: null,
                batchNo: null,
                invoiceNo: "OPENING-001",
                unitCost: 50,
                totalCost: 50000,
                entryDate: new Date("2026-06-01"),
                remarks: "Opening balance",
                createdById: "seed-script",
            },
        });
        entries.push(entry1);
        console.log(`✅ Entry 1 - OPENING BALANCE: 1000 KG`);

        // Create a batch for purchases/sales
        const batch1 = await prisma.inventoryBatch.create({
            data: {
                productId: PRODUCT_ID,
                batchNo: "BATCH-2026-001",
                currentStockKG: 0,
                currentStockLTR: 0,
            },
        });

        // ENTRY 2: PURCHASE (500 KG)
        const entry2 = await prisma.productLedgerEntry.create({
            data: {
                productLedgerId: ledger.id,
                movementType: ProductMovementType.PURCHASE,
                direction: ProductMovementDirection.INBOUND,
                quantityKG: 500,
                quantityLTR: null,
                unit: product.unit,
                branchId: branch.id,
                agencyId: null,
                purchaseId: null,
                saleId: null,
                batchId: batch1.id,
                batchNo: batch1.batchNo,
                invoiceNo: "PUR-2026-001",
                unitCost: 55,
                totalCost: 27500,
                entryDate: new Date("2026-06-05"),
                remarks: "Purchase from supplier",
                createdById: "seed-script",
            },
        });
        entries.push(entry2);
        console.log(`✅ Entry 2 - PURCHASE: 500 KG @ ₹55/unit`);

        // ENTRY 3: SALE (200 KG)
        const entry3 = await prisma.productLedgerEntry.create({
            data: {
                productLedgerId: ledger.id,
                movementType: ProductMovementType.SALE,
                direction: ProductMovementDirection.OUTBOUND,
                quantityKG: 200,
                quantityLTR: null,
                unit: product.unit,
                branchId: branch.id,
                agencyId: null,
                purchaseId: null,
                saleId: null,
                batchId: batch1.id,
                batchNo: batch1.batchNo,
                invoiceNo: "SAL-2026-001",
                unitCost: null,
                totalCost: null,
                entryDate: new Date("2026-06-08"),
                remarks: "Sale to customer",
                createdById: "seed-script",
            },
        });
        entries.push(entry3);
        console.log(`✅ Entry 3 - SALE: 200 KG`);

        // Create another batch
        const batch2 = await prisma.inventoryBatch.create({
            data: {
                productId: PRODUCT_ID,
                batchNo: "BATCH-2026-002",
                currentStockKG: 0,
                currentStockLTR: 0,
            },
        });

        // ENTRY 4: PURCHASE (800 KG)
        const entry4 = await prisma.productLedgerEntry.create({
            data: {
                productLedgerId: ledger.id,
                movementType: ProductMovementType.PURCHASE,
                direction: ProductMovementDirection.INBOUND,
                quantityKG: 800,
                quantityLTR: null,
                unit: product.unit,
                branchId: branch.id,
                agencyId: null,
                purchaseId: null,
                saleId: null,
                batchId: batch2.id,
                batchNo: batch2.batchNo,
                invoiceNo: "PUR-2026-002",
                unitCost: 60,
                totalCost: 48000,
                entryDate: new Date("2026-06-10"),
                remarks: "Purchase from supplier",
                createdById: "seed-script",
            },
        });
        entries.push(entry4);
        console.log(`✅ Entry 4 - PURCHASE: 800 KG @ ₹60/unit`);

        // ENTRY 5: SALE (300 KG)
        const entry5 = await prisma.productLedgerEntry.create({
            data: {
                productLedgerId: ledger.id,
                movementType: ProductMovementType.SALE,
                direction: ProductMovementDirection.OUTBOUND,
                quantityKG: 300,
                quantityLTR: null,
                unit: product.unit,
                branchId: branch.id,
                agencyId: null,
                purchaseId: null,
                saleId: null,
                batchId: batch2.id,
                batchNo: batch2.batchNo,
                invoiceNo: "SAL-2026-002",
                unitCost: null,
                totalCost: null,
                entryDate: new Date("2026-06-12"),
                remarks: "Sale to customer",
                createdById: "seed-script",
            },
        });
        entries.push(entry5);
        console.log(`✅ Entry 5 - SALE: 300 KG`);

        // ENTRY 6: ADJUSTMENT IN (50 KG)
        const entry6 = await prisma.productLedgerEntry.create({
            data: {
                productLedgerId: ledger.id,
                movementType: ProductMovementType.ADJUSTMENT_IN,
                direction: ProductMovementDirection.INBOUND,
                quantityKG: 50,
                quantityLTR: null,
                unit: product.unit,
                branchId: branch.id,
                agencyId: null,
                purchaseId: null,
                saleId: null,
                batchId: null,
                batchNo: null,
                invoiceNo: "ADJ-2026-001",
                unitCost: null,
                totalCost: null,
                entryDate: new Date("2026-06-14"),
                remarks: "Stock adjustment (inventory count difference)",
                createdById: "seed-script",
            },
        });
        entries.push(entry6);
        console.log(`✅ Entry 6 - ADJUSTMENT IN: 50 KG`);

        console.log(
            `\n📊 Seed complete! Created ${entries.length} ProductLedgerEntry records\n`
        );

        // Step 6: Calculate and display running balance
        console.log("📈 Running Balance Calculation:");
        console.log("════════════════════════════════════════════════════════\n");

        let balance = 0;
        entries.forEach((entry, index) => {
            const quantity =
                entry.direction === ProductMovementDirection.INBOUND
                    ? entry.quantityKG || 0
                    : -(entry.quantityKG || 0);

            balance += quantity;

            const type = entry.movementType.padEnd(15);
            const qty = (entry.quantityKG || 0).toString().padEnd(8);
            const dir = entry.direction.padEnd(8);

            console.log(
                `${index + 1}. ${type} | Qty: ${qty} | Dir: ${dir} | Balance: ${balance} KG`
            );
        });

        console.log("\n════════════════════════════════════════════════════════");
        console.log(`✅ Final Balance: ${balance} KG\n`);

        // Step 7: Show Inventory status
        const inventory = await prisma.inventory.findFirst({
            where: { productId: PRODUCT_ID },
        });

        console.log("📦 Inventory Status:");
        if (inventory) {
            console.log(`   Current Stock: ${inventory.currentStockKG} KG`);
            console.log(`   Last Updated: ${inventory.updatedAt}\n`);
        } else {
            console.log("   No inventory record found (will be created during purchase/sale)\n");
        }

        // Step 8: Test endpoints
        console.log("🧪 Test these endpoints:\n");
        console.log(`GET /api/product-ledger/${PRODUCT_ID}/detail`);
        console.log(`   → Shows product info + paginated movements\n`);

        console.log(`GET /api/product-ledger/${PRODUCT_ID}/full-history`);
        console.log(`   → Shows all movements with running balance\n`);

        console.log(`GET /api/product-ledger/${PRODUCT_ID}/stock`);
        console.log(`   → Shows current global stock\n`);

        console.log(`GET /api/product-ledger/${PRODUCT_ID}/branch-stock`);
        console.log(`   → Shows branch-wise stock distribution\n`);

        console.log("✨ Seed script completed successfully!\n");

    } catch (error) {
        console.error("❌ Error during seeding:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
