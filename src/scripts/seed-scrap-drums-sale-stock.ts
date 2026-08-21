import { AgencyType, ProductType, ProductUnit } from "@prisma/client";
import { prisma } from "../config/db";
import { InventoryService } from "../modules/inventory/inventory.service";
import { ProductLedgerService } from "../modules/accounting/productLedger/productLedger.service";
import { SalesService } from "../modules/sales/sales.service";

/**
 * Backfills the two SCRAP DRUM sales that failed during the Excel import.
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
const INVOICES = ["APM/G2526/2332", "APM/G2526/3078"];
const FALLBACK_QUANTITY_KG = 2_000;
const SEED_REFERENCE_PREFIX = "SEED_SCRAP_DRUMS_SALE_IMPORT_2026";

const SALES = [
    {
        invoiceNo: "APM/G2526/2332",
        invoiceDate: "2026-01-31T00:00:00.000Z",
        despatchDocNo: "352",
        destination: "MEHSANA, GUJARAT",
        vehicleNo: "GJ02BT9969",
        narration: "BEING SALE SCRAP DRUM QTY 1000 NOS @ 180 AGST INVOICE NO. APM/G2526/2332 DTD 31/01/2026 VEHICLE NO GJ02BT9969 TCS CHARGE @212400*1%=2124/-"
    },
    {
        invoiceNo: "APM/G2526/3078",
        invoiceDate: "2026-03-19T00:00:00.000Z",
        despatchDocNo: "360",
        destination: "MEHSANA",
        vehicleNo: "GJ02ZZ8469",
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
            quantity: 1_000,
            unit: ProductUnit.KG
        });
        if (fifo.shortage > 0) {
            throw new Error(`Insufficient SCRAP DRUM stock for ${record.invoiceNo}: shortage ${fifo.shortage} KG.`);
        }

        const items = fifo.allocations.map(({ batch, quantity }) => {
            const taxableAmount = quantity * 180;
            const igstAmount = taxableAmount * 0.18;
            return {
                productId,
                batchId: batch.id,
                quantity,
                unit: ProductUnit.KG,
                unitPrice: 180,
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
            roundOffAmount: 2124,
            transport: {
                despatchDocNo: record.despatchDocNo,
                despatchThrough: "ROYAL ROADLINES",
                destination: record.destination,
                vehicleOrFlightNo: record.vehicleNo
            },
            importedTotals: {
                subTotal: 180000,
                totalCGST: 0,
                totalSGST: 0,
                totalIGST: 32400,
                totalGST: 32400,
                roundOff: 2124,
                grandTotal: 214524
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
                baseUnit: ProductUnit.KG,
                operationalUnit: ProductUnit.KG,
                density: 1,
                applicableGST: 0,
                openingStockKG: 0,
                sellPricePerUnit: 0,
                isActive: true
            }
        });
        console.log(`Created product: ${PRODUCT_NAME}.`);
    }

    const sales = await prisma.sale.findMany({
        where: {
            invoiceNo: { in: INVOICES },
            status: "PENDING"
        },
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
                    productId: product.id,
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
                    productId: product.id,
                    batchNo,
                    quantity: FALLBACK_QUANTITY_KG,
                    unit: ProductUnit.KG,
                    purchasePrice: 0,
                    transactionDate: new Date("2026-01-01T00:00:00.000Z")
                });

                const ledger = await ProductLedgerService.getOrCreateProductLedger(product.id, tx);
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
                    where: { id: product.id },
                    data: { openingStockKG: { increment: FALLBACK_QUANTITY_KG } }
                });
            });
            console.log(`Created ${FALLBACK_QUANTITY_KG} KG opening stock in ${batchNo}.`);
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
                quantity: allocation.quantityKG,
                unit: ProductUnit.KG,
                purchasePrice: 0,
                transactionDate: allocation.date
            });

            const ledger = await ProductLedgerService.getOrCreateProductLedger(product.id, tx);
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
                where: { id: product.id },
                data: { openingStockKG: { increment: allocation.quantityKG } }
            });
        });

        seededQuantity += allocation.quantityKG;
        console.log(`Seeded ${allocation.quantityKG} KG into batch ${batchId}.`);
    }

    console.log(`Completed. Seeded ${seededQuantity} KG for ${sales.length} pending sale(s).`);
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
