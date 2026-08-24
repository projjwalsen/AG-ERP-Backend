import { AgencyType, ProductType, ProductUnit } from "@prisma/client";
import { prisma } from "../config/db";
import { InventoryService } from "../modules/inventory/inventory.service";
import { ProductLedgerService } from "../modules/accounting/productLedger/productLedger.service";
import { SalesService } from "../modules/sales/sales.service";

/**
 * Backfills the three SCRAP DRUM sales that failed during the Excel import.
 *
 * It creates the product and opening stock when needed, then creates and
 * approves each missing sale through SalesService. Approval is deliberate:
 * it consumes stock, creates the product-ledger SALE movement, updates the
 * customer outstanding balance, and creates the normal accounting sale voucher.
 *
 * Existing pending sales from a prior import are repaired and approved instead
 * of being duplicated.
 */

const PRODUCT_NAME = "SCRAP DRUM";
const PRODUCT_SKU = "SCRAP-DRUM-SEED-2026";
const INVOICES = ["APM/G2526/0433", "APM/G2526/2332", "APM/G2526/3078"];
const SEED_REFERENCE_PREFIX = "SEED_SCRAP_DRUMS_SALE_IMPORT_2026";

const SALES = [
    {
        invoiceNo: "APM/G2526/0433",
        invoiceDate: "2025-06-04T00:00:00.000Z",
        despatchDocNo: "042",
        destination: "Mehsana, Gujarat",
        vehicleNo: "GJ02ZZ8469",
        quantity: 1_000,
        unitPrice: 190,
        taxableAmount: 190_000,
        igstAmount: 34_200,
        tcsAmount: 2_242,
        grandTotal: 226_442,
        narration: "GJ02ZZ8469 TCS 224200*1/100=2242 (NOS 1000*190=190000)"
    },
    {
        invoiceNo: "APM/G2526/2332",
        invoiceDate: "2026-01-31T00:00:00.000Z",
        despatchDocNo: "352",
        destination: "MEHSANA, GUJARAT",
        vehicleNo: "GJ02BT9969",
        quantity: 1_000,
        unitPrice: 180,
        taxableAmount: 180_000,
        igstAmount: 32_400,
        tcsAmount: 2_124,
        grandTotal: 214_524,
        narration: "BEING SALE SCRAP DRUM QTY 1000 NOS @ 180 AGST INVOICE NO. APM/G2526/2332 DTD 31/01/2026 VEHICLE NO GJ02BT9969 TCS CHARGE @212400*1%=2124/-"
    },
    {
        invoiceNo: "APM/G2526/3078",
        invoiceDate: "2026-03-19T00:00:00.000Z",
        despatchDocNo: "360",
        destination: "MEHSANA",
        vehicleNo: "GJ02ZZ8469",
        quantity: 1_000,
        unitPrice: 180,
        taxableAmount: 180_000,
        igstAmount: 32_400,
        tcsAmount: 2_124,
        grandTotal: 214_524,
        narration: "BEING SALE SCRAP DRUMS 1000 NOS @180/- AGST INV NO APM/G2526/3078 DATE: 19/03/2026 VEHICLE NO GJ02ZZ8469 TCS CHARGE 212400=2124/-"
    }
] as const;

async function resolveSeedActor() {
    const actor = await prisma.user.findFirst({
        where: {
            isActive: true,
            status: "ACTIVE",
            userRoles: {
                some: {
                    role: {
                        isActive: true,
                        rolePermissions: {
                            some: {
                                permission: {
                                    key: "SALE:APPROVE",
                                    isActive: true
                                }
                            }
                        }
                    }
                }
            }
        },
        select: { id: true, name: true }
    });

    if (!actor) {
        throw new Error("No active user with SALE:APPROVE permission was found.");
    }

    return actor;
}

async function resolveClient() {
    const existing = await prisma.agency.findFirst({
        where: {
            OR: [
                { gstin: "24CBRPP0420M1ZG" },
                { name: { equals: "M.N.TRADERS", mode: "insensitive" } }
            ]
        }
    });

    const data = {
        name: "M.N.TRADERS",
        gstin: "24CBRPP0420M1ZG",
        panNo: "CBRPP0420M",
        addressLine1: "220, Chadasana, Kadi",
        addressLine2: "Mehsana",
        city: "MEHSANA",
        state: "Gujarat",
        stateCode: "24",
        pinCode: "382715",
        isActive: true
    };

    if (!existing) {
        return prisma.agency.create({ data: { ...data, type: AgencyType.CLIENT } });
    }

    return prisma.agency.update({
        where: { id: existing.id },
        data: {
            ...data,
            type: existing.type === AgencyType.VENDOR ? AgencyType.BOTH : existing.type
        }
    });
}

async function createOrApproveSales(productId: string) {
    const [actor, agency, branch] = await Promise.all([
        resolveSeedActor(),
        resolveClient(),
        prisma.branch.findFirst({ where: { isActive: true } })
    ]);
    if (!branch) throw new Error("No active branch found for the sales backfill.");

    for (const record of SALES) {
        const existing = await prisma.sale.findUnique({ where: { invoiceNo: record.invoiceNo } });
        if (existing?.status === "APPROVED") {
            console.log(`Skipped ${record.invoiceNo}: sale is already approved.`);
            continue;
        }
        if (existing) {
            await SalesService.approveSale(actor, existing.id);
            console.log(`Approved existing pending sale ${record.invoiceNo}.`);
            continue;
        }

        const fifo = await InventoryService.allocateFIFO(prisma, {
            branchId: branch.id,
            productId,
            quantity: record.quantity,
            unit: ProductUnit.NOS
        });
        if (fifo.shortage > 0) {
            throw new Error(`Insufficient SCRAP DRUM stock for ${record.invoiceNo}: shortage ${fifo.shortage} NOS.`);
        }

        const items = fifo.allocations.map(({ batch, quantity }) => {
            const taxableAmount = quantity * record.unitPrice;
            const igstAmount = taxableAmount * 0.18;
            return {
                productId,
                batchId: batch.id,
                quantity,
                unit: ProductUnit.NOS,
                unitPrice: record.unitPrice,
                taxableAmount,
                gstPercent: 18,
                cgstAmount: 0,
                sgstAmount: 0,
                igstAmount,
                gstAmount: igstAmount,
                totalAmount: taxableAmount + igstAmount
            };
        });

        const sale = await SalesService.createSale(actor, {
            agencyId: agency.id,
            branchId: branch.id,
            invoiceNo: record.invoiceNo,
            voucherNo: record.invoiceNo,
            invoiceDate: record.invoiceDate,
            voucherDate: record.invoiceDate,
            approvedAt: record.invoiceDate,
            remarks: record.narration,
            roundOffAmount: record.tcsAmount,
            transport: {
                despatchDocNo: record.despatchDocNo,
                despatchThrough: "ROYAL ROADLINES",
                destination: record.destination,
                vehicleOrFlightNo: record.vehicleNo
            },
            importedTotals: {
                subTotal: record.taxableAmount,
                totalCGST: 0,
                totalSGST: 0,
                totalIGST: record.igstAmount,
                totalGST: record.igstAmount,
                roundOff: record.tcsAmount,
                grandTotal: record.grandTotal
            },
            items
        });

        await SalesService.approveSale(actor, sale.id);
        console.log(`Created and approved ${record.invoiceNo}.`);
    }
}

async function main() {
    let product = await prisma.product.findFirst({
        where: {
            name: {
                equals: PRODUCT_NAME,
                mode: "insensitive"
            }
        }
    });

    if (!product) {
        product = await prisma.product.create({
            data: {
                sku: PRODUCT_SKU,
                name: PRODUCT_NAME,
                productType: ProductType.PURCHASED,
                baseUnit: ProductUnit.NOS,
                operationalUnit: ProductUnit.NOS,
                density: 1,
                applicableGST: 0,
                openingStockKG: 0,
                sellPricePerUnit: 0,
                isActive: true
            }
        });
        console.log(`Created product: ${PRODUCT_NAME}.`);
    } else if (
        product.baseUnit !== ProductUnit.NOS ||
        product.operationalUnit !== ProductUnit.NOS
    ) {
        product = await prisma.product.update({
            where: { id: product.id },
            data: {
                baseUnit: ProductUnit.NOS,
                operationalUnit: ProductUnit.NOS
            }
        });
        console.log(`Updated product unit to NOS: ${PRODUCT_NAME}.`);
    }

    // A previous failed import may have left these sales pending with the
    // default KG unit. They are count-based drum sales, so correct the unit
    // before stock is topped up and the sale is approved.
    await prisma.salesItem.updateMany({
        where: {
            sale: {
                invoiceNo: { in: INVOICES },
                status: "PENDING"
            },
            unit: { in: [ProductUnit.KG, ProductUnit.MT] }
        },
        data: { unit: ProductUnit.NOS }
    });

    const existingSales = await prisma.sale.findMany({
        where: {
            invoiceNo: { in: INVOICES }
        },
        select: { invoiceNo: true }
    });
    const existingInvoiceNos = new Set(existingSales.map(sale => sale.invoiceNo));
    const missingSales = SALES.filter(sale => !existingInvoiceNos.has(sale.invoiceNo));

    const sales = await prisma.sale.findMany({
        where: { invoiceNo: { in: INVOICES }, status: "PENDING" },
        include: {
            items: {
                where: { productId: product.id },
                select: {
                    batchId: true,
                    quantity: true,
                    unit: true
                }
            }
        }
    });

    const allocations = new Map<string, { branchId: string; quantityNOS: number; date: Date }>();

    for (const sale of sales) {
        for (const item of sale.items) {
            if (item.unit !== ProductUnit.NOS) {
                throw new Error(
                    `Invoice ${sale.invoiceNo} uses ${item.unit}; this seed only supports NOS stock.`
                );
            }

            const quantityNOS = Number(item.quantity);
            const existing = allocations.get(item.batchId);

            allocations.set(item.batchId, {
                branchId: sale.branchId,
                quantityNOS: Number(((existing?.quantityNOS || 0) + quantityNOS).toFixed(3)),
                date: sale.invoiceDate,
            });
        }
    }

    if (sales.length > 0 && allocations.size === 0) {
        throw new Error(
            "A pending SCRAP DRUM sale has no SCRAP DRUM item allocation; it cannot be safely approved."
        );
    }

    if (sales.length === 0 && missingSales.length === 0) {
        console.log("Skipped: all three SCRAP DRUM sales are already approved.");
        return;
    }

    const missingQuantityNOS = missingSales.reduce(
        (sum, sale) => sum + sale.quantity,
        0
    );

    // Existing pending sales retain their original batch allocation. Missing
    // sales use this same stock pool and will allocate FIFO when created.
    if (missingQuantityNOS > 0 && allocations.size > 0) {
        const [batchId, allocation] = allocations.entries().next().value!;
        allocations.set(batchId, {
            ...allocation,
            quantityNOS: allocation.quantityNOS + missingQuantityNOS,
            date: new Date("2025-01-01T00:00:00.000Z")
        });
    }

    if (allocations.size === 0) {
        const branch = await prisma.branch.findFirst({ where: { isActive: true } });
        if (!branch) throw new Error("No active branch found for the opening stock batch.");

        const batchNo = "SCRAP-DRUMS-OPENING-2025-01";
        const batch = await prisma.inventoryBatch.findUnique({
            where: {
                branchId_productId_batchNo: {
                    branchId: branch.id,
                    productId: product.id,
                    batchNo
                }
            }
        });

        if (batch) {
            allocations.set(batch.id, {
                branchId: branch.id,
                quantityNOS: missingQuantityNOS,
                date: new Date("2025-01-01T00:00:00.000Z")
            });
        } else {
            await prisma.$transaction(async tx => {
                const created = await InventoryService.addStock(tx, {
                    branchId: branch.id,
                    productId: product.id,
                    batchNo,
                    quantity: missingQuantityNOS,
                    unit: ProductUnit.NOS,
                    purchasePrice: 0,
                    transactionDate: new Date("2025-01-01T00:00:00.000Z")
                });

                const ledger = await ProductLedgerService.getOrCreateProductLedger(product.id, tx);
                await tx.productLedgerEntry.create({
                    data: {
                        productLedgerId: ledger.id,
                        movementType: "OPENING_BALANCE",
                        direction: "CREDIT",
                        quantityKG: missingQuantityNOS,
                        quantityLTR: 0,
                        unit: ProductUnit.NOS,
                        branchId: branch.id,
                        batchId: created.id,
                        batchNo,
                        invoiceNo: "OPENING STOCK",
                        unitCost: 0,
                        totalCost: 0,
                        entryDate: new Date("2025-01-01T00:00:00.000Z"),
                        reference: `${SEED_REFERENCE_PREFIX}:${batchNo}`,
                        remarks: "Opening stock for APM/G2526/0433, APM/G2526/2332 and APM/G2526/3078"
                    }
                });
                await tx.product.update({
                    where: { id: product.id },
                    data: { openingStockKG: { increment: missingQuantityNOS } }
                });
            });
            console.log(`Created ${missingQuantityNOS} NOS opening stock in ${batchNo}.`);
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
                productId: product.id,
                batchNo: batch.batchNo,
                quantity: allocation.quantityNOS,
                unit: ProductUnit.NOS,
                purchasePrice: 0,
                transactionDate: allocation.date
            });

            const ledger = await ProductLedgerService.getOrCreateProductLedger(product.id, tx);
            await tx.productLedgerEntry.create({
                data: {
                    productLedgerId: ledger.id,
                    movementType: "OPENING_BALANCE",
                    direction: "CREDIT",
                    quantityKG: allocation.quantityNOS,
                    quantityLTR: 0,
                    unit: ProductUnit.NOS,
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
                where: { id: product.id },
                    data: { openingStockKG: { increment: allocation.quantityNOS } }
            });
        });

        seededQuantity += allocation.quantityNOS;
        console.log(`Seeded ${allocation.quantityNOS} NOS into batch ${batchId}.`);
    }

    console.log(`Completed. Seeded ${seededQuantity} NOS for ${sales.length} pending sale(s).`);
    await createOrApproveSales(product.id);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
