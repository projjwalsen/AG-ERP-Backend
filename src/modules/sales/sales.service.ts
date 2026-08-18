import { OutstandingType, ProductUnit } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { RBACService } from "../rbac/rbac.service";
import { InventoryService } from "../inventory/inventory.service";
import { SalesToInvMapper } from "../../core/utils/saleToInvMapper";
import { InvoiceRenderer } from "../../core/utils/invoiceRenderer";
import { randomUUID } from "crypto";
import { ProductLedgerService } from "../accounting/productLedger/productLedger.service";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { buildSaleNarration } from "../../core/utils/narration";

type SalesItemPayload = {
    productId: string;
    batchId: string;

    quantity: number;
    unit: ProductUnit;

    unitPrice?: number;

    taxableAmount?: number;

    gstPercent?: number;

    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;

    gstAmount?: number;

    totalAmount?: number;
}

type SaleTransportPayload = {

    /** Delivery */

    deliveryNote?: string;

    buyerOrderNo?: string;

    buyerOrderDate?: string;

    termsOfDelivery?: string;

    /** Dispatch */

    despatchDocNo?: string;

    despatchDocDate?: string;

    despatchThrough?: string;

    destination?: string;

    vehicleOrFlightNo?: string;

    billOfLadingNo?: string;

    /** Export */

    portOfLoading?: string;

    portOfDischarge?: string;

    countryTo?: string;

    shippingNo?: string;

    shippingDate?: string;

    portCode?: string;
};

type CreateSalesPayload = {

    agencyId:string;
    branchId:string;

    invoiceNo?:string;
    remarks?:string;
    invoiceDate?:string;

    voucherType?: string;
    otherReference?:string;

    irn?: string;
    ackNo?: string;
    ackDate?: string;
    qrCodeImage?: string;
    modeOfPayment?: string;
    referenceNo?: string;
    referenceDate?: string;

    transport?: SaleTransportPayload;
    roundOffAmount?:number;
    voucherDate?: string;
    approvedAt?: string;

    items:SalesItemPayload[];
    importedTotals?: {
        subTotal: number;
        totalCGST: number;
        totalSGST: number;
        totalIGST: number;
        totalGST: number;
        roundOff: number;
        grandTotal: number;
    };

    deferStockValidation?: boolean;
}

export class SalesService {

    /**
     * Collapse repeated lines for the same product and batch.
     * A sale item represents a product/batch allocation, so repeated lines
     * are safely combined before validation and persistence.
     */
    private static mergeDuplicateBatchItems(
        items: SalesItemPayload[]
    ): SalesItemPayload[] {
        const merged = new Map<string, SalesItemPayload>();
        const sumFields: (keyof SalesItemPayload)[] = [
            "quantity",
            "taxableAmount",
            "cgstAmount",
            "sgstAmount",
            "igstAmount",
            "gstAmount",
            "totalAmount"
        ];

        for (const item of items) {
            const key = `${item.productId}-${item.batchId}-${item.unit}`;
            const existing = merged.get(key);

            if (!existing) {
                merged.set(key, { ...item });
                continue;
            }

            for (const field of sumFields) {
                const current = Number(existing[field] || 0);
                const incoming = Number(item[field] || 0);
                (existing as any)[field] = current + incoming;
            }
        }

        return [...merged.values()];
    }

    /**
     * ===========================
     * Auto generate sales invoice number
     * 
     * Example:
     * SAL-PET-SA8X2
     * SAL-DIE-QW91L
     *
     * Format:
     * [PRODUCT2]-[BATCH2][UNIQUE]
    */
    static async generateInvoiceNo(
        productName: string,
        batchNo: string
    ) {
        const productPrefix = productName
            .replace(/[^A-Z0-9]/gi, "")
            .substring(0, 3)
            .toUpperCase()
            .padEnd(3, "X");

        const batchPrefix = batchNo
            .replace(/[^A-Z0-9]/gi, "")
            .substring(0, 2)
            .toUpperCase()
            .padEnd(2, "X");

        /** Using Date.now to handle uniqueness */
        const unique = randomUUID()
            .replace(/-/g, "")
            .substring(0, 10)
            .toUpperCase();

        return `SAL-${productPrefix}-${batchPrefix}${unique}`;
    }

    /**
     * ===========================
     * Create sales invoice
     * 
     * Steps:
     * 1. Validate payload
     * 2. Generate invoice number
     * 3. Create sales record
     */
    static async createSale(
        actor: any,
        payload: CreateSalesPayload
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(
            !payload.agencyId ||
            !payload.branchId
        ) {
            throw new ApiError("Agency & Branch Id are required", 400);
        }

        payload.items = this.mergeDuplicateBatchItems(payload.items || []);

        if(
            !payload.items ||
            payload.items.length === 0
        ) {
            throw new ApiError("At least one sales item is required", 400);
        }

        /** Agency / Branch validation */
        const [agency, branch] = await Promise.all([
            prisma.agency.findUnique({
                where: {
                    id: payload.agencyId
                }
            }),
            prisma.branch.findUnique({
                where: {
                    id: payload.branchId
                }
            })
        ]);

        if(!agency) {
            throw new ApiError("Invalid Agency Id", 400);
        }

        if(
            agency.type !== "CLIENT" &&
            agency.type !== "BOTH"
        ) {
            throw new ApiError("Agency must be of type CLIENT or BOTH", 400);
        }

        if(!branch) {
            throw new ApiError("Invalid Branch Id", 400);
        }

        if(!branch.isActive){
            throw new ApiError("Branch is not active", 400);
        }

        const setting = await prisma.setting.findFirst();
        const allowNegativeStock = setting?.allowNegativeInventory ?? false;

        /** Validate items */
        const validatedItems = [];
        const batchIds = [...new Set(payload.items.map(item => item.batchId).filter(Boolean))];
        const batches = await prisma.inventoryBatch.findMany({
            where: {
                id: {
                    in: batchIds
                }
            },
            include: {
                product: true
            }
        });

        const batchMap = new Map(
            batches.map(batch => [batch.id, batch])
        );

        for (const item of payload.items) {

            if (
                !item.productId ||
                !item.batchId
            ) {
                throw new ApiError(
                    "Product & Batch Id required",
                    400
                );
            }

            if (
                !item.quantity ||
                item.quantity <= 0
            ) {
                throw new ApiError(
                    "Invalid quantity",
                    400
                );
            }

            const batch = batchMap.get(item.batchId);

            if (!batch) {
                throw new ApiError(
                    `Invalid Batch Id ${item.batchId}. Not found !`,
                    400
                );
            }

            if(item.unit === ProductUnit.KG || item.unit === ProductUnit.MT){
                const requiredQtyKG =
                    item.unit === ProductUnit.MT
                        ? Number(item.quantity) * 1000
                        : Number(item.quantity);

                if( 
                    !allowNegativeStock &&
                    !payload.deferStockValidation &&
                    Number(batch.availableQtyKG) < requiredQtyKG
                ) {
                    throw new ApiError(
                        `Insufficient stock for product ${batch.product.name} in batch ${batch.batchNo}, Available : ${batch.availableQtyKG} KG. Allow negative stock setting.`,
                        400
                    )
                }
            } else {
                if(
                    !allowNegativeStock &&
                    !payload.deferStockValidation &&
                    Number(batch.availableQtyLTR) < Number(item.quantity)
                ) {
                    throw new ApiError(
                        `Insufficient stock for product ${batch.product.name} in batch ${batch.batchNo}, Available : ${batch.availableQtyLTR} LTR. Allow negative stock setting.`,
                        400
                    )
                }
            }

            if (!batch) {
                throw new ApiError(
                    `Invalid Batch Id ${item.batchId}. Not found !`,
                    400
                );
            }

            if (!batch.isActive) {
                throw new ApiError(
                    `Batch ${batch.batchNo} inactive`,
                    400
                );
            }

            if (batch.productId !== item.productId) {
                throw new ApiError(
                    "Batch product mismatch",
                    400
                );
            }

            if (batch.branchId !== payload.branchId) {
                throw new ApiError(
                    "Batch branch mismatch",
                    400
                );
            }

            /** GST calculation */
            const systemSellingPrice =
                item.unit === ProductUnit.LTR
                    ? Number(
                        batch.product.sellPriceLTR ||
                        batch.product.sellPricePerUnit
                    )
                    : item.unit === ProductUnit.MT
                    ? Number(batch.product.sellPricePerUnit) * 1000
                    : Number(
                        batch.product.sellPricePerUnit
                    );

            const sellingPrice =
                item.unitPrice
                    ? Number(item.unitPrice)
                    : systemSellingPrice;

            const gstPercent =
                payload.importedTotals
                    ? Number(item.gstPercent ?? 0)
                    : Number(batch.product.applicableGST) || 0;

            const taxableAmount =
                payload.importedTotals
                    ? Number(item.taxableAmount ?? 0)
                    : Number(item.quantity) * sellingPrice;

            let cgstPercent = 0;
            let sgstPercent = 0;
            let igstPercent = 0;

            let cgstAmount = 0;
            let sgstAmount = 0;
            let igstAmount = 0;

            let gstAmount = 0;
            let totalAmount = 0;

            if (payload.importedTotals) {

                cgstAmount = Number(item.cgstAmount ?? 0);

                sgstAmount = Number(item.sgstAmount ?? 0);

                igstAmount = Number(item.igstAmount ?? 0);

                gstAmount = Number(item.gstAmount ?? 0);

                totalAmount = Number(item.totalAmount ?? 0);

                if (gstPercent > 0) {

                    if (cgstAmount > 0 || sgstAmount > 0) {

                        cgstPercent = gstPercent / 2;
                        sgstPercent = gstPercent / 2;

                    } else {

                        igstPercent = gstPercent;

                    }

                }

            } else {

                if (agency.stateCode === branch.stateCode) {

                    cgstPercent = gstPercent / 2;
                    sgstPercent = gstPercent / 2;

                    cgstAmount =
                        (taxableAmount * cgstPercent) / 100;

                    sgstAmount =
                        (taxableAmount * sgstPercent) / 100;

                } else {

                    igstPercent = gstPercent;

                    igstAmount =
                        (taxableAmount * igstPercent) / 100;

                }

                gstAmount =
                    cgstAmount +
                    sgstAmount +
                    igstAmount;

                totalAmount =
                    taxableAmount +
                    gstAmount;
            }

            validatedItems.push({
                item,
                batch,
                product: batch.product,

                sellingPrice,

                taxableAmount,

                gstPercent,

                cgstPercent,
                sgstPercent,
                igstPercent,

                cgstAmount,
                sgstAmount,
                igstAmount,

                gstAmount,
                totalAmount
            });

        }

        const firstItem = validatedItems[0];
        const invoiceNo =
            payload.invoiceNo?.trim()
                ??
            await this.generateInvoiceNo(
                firstItem.product.name,
                firstItem.batch.batchNo
            );

        let subtotalAmount = 0;
        let totalGSTAmount = 0;

        let totalCGSTAmount = 0;
        let totalSGSTAmount = 0;
        let totalIGSTAmount = 0;

        let grandTotal = 0;

        const money = (value: number) =>
            Math.round(Number(value || 0) * 100) / 100;

        for(const item of validatedItems) {
            subtotalAmount =
                money(subtotalAmount + item.taxableAmount);

            totalGSTAmount =
                money(totalGSTAmount + item.gstAmount);

            totalCGSTAmount =
                money(totalCGSTAmount + item.cgstAmount);
            totalSGSTAmount =
                money(totalSGSTAmount + item.sgstAmount);
            totalIGSTAmount =
                money(totalIGSTAmount + item.igstAmount);

            grandTotal =
                money(grandTotal + item.totalAmount);
        }

        if (payload.importedTotals) {
            const expectedGrandTotal =
                money(
                    subtotalAmount +
                    totalGSTAmount +
                    (payload.roundOffAmount ?? 0)
                );

            if (
                Math.abs(
                    money(payload.importedTotals.subTotal) -
                    subtotalAmount
                ) > 0.01 ||
                Math.abs(
                    money(payload.importedTotals.totalGST) -
                    totalGSTAmount
                ) > 0.01 ||
                Math.abs(
                    money(payload.importedTotals.grandTotal) -
                    expectedGrandTotal
                ) > 0.01
            ) {
                throw new ApiError(
                    `Sale import total mismatch for invoice ${invoiceNo}. Items ${subtotalAmount} + GST ${totalGSTAmount} + RoundOff ${payload.roundOffAmount ?? 0} = ${expectedGrandTotal}, but imported Grand Total is ${payload.importedTotals.grandTotal}`,
                    400
                );
            }

            subtotalAmount =
                payload.importedTotals.subTotal;

            totalCGSTAmount =
                payload.importedTotals.totalCGST;

            totalSGSTAmount =
                payload.importedTotals.totalSGST;

            totalIGSTAmount =
                payload.importedTotals.totalIGST;

            totalGSTAmount =
                payload.importedTotals.totalGST;

            grandTotal =
                payload.importedTotals.grandTotal;

        } else {

            grandTotal +=
                payload.roundOffAmount ?? 0;

        }

        /**
         * Create sales record
        */
        const sale = await prisma.sale.create({
            data: {
                agencyId: payload.agencyId,

                branchId: payload.branchId,

                invoiceNo,

                invoiceDate:
                    payload.invoiceDate
                    ? new Date(payload.invoiceDate)
                    : new Date(),

                voucherType:
                    "SALE",

                otherReference:
                    payload.otherReference?.trim(),

                irn:
                    payload.irn?.trim(),

                ackNo:
                    payload.ackNo?.trim(),

                ackDate:
                    payload.ackDate
                        ? new Date(payload.ackDate)
                        : undefined,

                qrCodeImage:
                    payload.qrCodeImage?.trim(),

                modeOfPayment:
                    payload.modeOfPayment?.trim(),

                referenceNo:
                    payload.referenceNo?.trim(),

                referenceDate:
                    payload.referenceDate
                        ? new Date(payload.referenceDate)
                        : undefined,

                roundOffAmount:
                    payload.roundOffAmount ?? 0,

                remarks:
                    payload.remarks?.trim(),

                createdById: actor.id,
                createdAt: payload.voucherDate
                    ? new Date(payload.voucherDate)
                    : new Date(),

                subTotalAmount: subtotalAmount,

                totalGSTAmount,

                totalCGSTAmount,

                totalSGSTAmount,

                totalIGSTAmount,

                grandTotal,

                transport:{

                    create:{

                        deliveryNote:
                            payload.transport?.deliveryNote,

                        buyerOrderNo:
                            payload.transport?.buyerOrderNo,

                        buyerOrderDate:
                            payload.transport?.buyerOrderDate
                                ? new Date(payload.transport.buyerOrderDate)
                                : undefined,

                        termsOfDelivery:
                            payload.transport?.termsOfDelivery,

                        despatchDocNo:
                            payload.transport?.despatchDocNo,

                        despatchDocDate:
                            payload.transport?.despatchDocDate
                                ? new Date(payload.transport.despatchDocDate)
                                : undefined,

                        despatchThrough:
                            payload.transport?.despatchThrough,

                        destination:
                            payload.transport?.destination,

                        vehicleOrFlightNo:
                            payload.transport?.vehicleOrFlightNo,

                        billOfLadingNo:
                            payload.transport?.billOfLadingNo,

                        portOfLoading:
                            payload.transport?.portOfLoading,

                        portOfDischarge:
                            payload.transport?.portOfDischarge,

                        countryTo:
                            payload.transport?.countryTo,

                        shippingNo:
                            payload.transport?.shippingNo,

                        shippingDate:
                            payload.transport?.shippingDate
                                ? new Date(payload.transport.shippingDate)
                                : undefined,

                        portCode:
                            payload.transport?.portCode

                    }

                },

                items: {
                    create: validatedItems.map((data) => ({
                        productId: data.item.productId,
                        batchId: data.item.batchId,
                        quantity: data.item.quantity,
                        unit: data.item.unit,

                        /**
                         * AUTO FETCH SELL PRICE
                         */
                        sellingPrice:
                            data.sellingPrice,

                        taxableAmount: data.taxableAmount,
                        gstPercent: data.gstPercent,
                        cgstPercent: data.cgstPercent,
                        sgstPercent: data.sgstPercent,
                        igstPercent: data.igstPercent,

                        cgstAmount: data.cgstAmount,
                        sgstAmount: data.sgstAmount,
                        igstAmount: data.igstAmount,

                        gstAmount: data.gstAmount,
                        totalAmount: data.totalAmount
                    }))
                }
            },

            include: {
                agency: true,
                branch: true,
                transport: true,
                transactions: true,
                items: {
                    include: {
                        product: true,
                        batch: true
                    }
                }
            }
        });

        const existingRemarks =
            sale.remarks?.trim();

        if (existingRemarks) {
            return sale;
        }

        const narration =
            buildSaleNarration(
                sale
            );

        const updatedSale =
            await prisma.sale.update({

                where: {
                    id: sale.id
                },

                data: {
                    remarks: narration
                },

                include: {
                    agency: true,
                    branch: true,
                    transport: true,
                    transactions: true,

                    items: {
                        include: {
                            product: true,
                            batch: true
                        }
                    }
                }
            });

        return updatedSale;
    }

    /**
     * =========================================
     * GET ALL SALES
     * =========================================
     */
    static async getAllSales(
        actor: any,
        query?: {
            page?: number;
            limit?: number;
            status?: "PENDING"| "APPROVED" | "REJECTED";
            branchId?: string;
            search?: string;
        }
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 10;
        const skip = (page - 1) * limit;

        const search = query?.search?.trim();

        const where: any = {
            ...(
                query?.status && { status: query.status }
            ),
            ...(
                query?.branchId && { branchId: query.branchId }
            ),
            ...(
                search && {
                    OR: [
                        {
                            invoiceNo: {
                                contains: search,
                                mode: "insensitive"
                            }
                        },
                        {
                            agency: {
                                name: {
                                    contains: search,
                                    mode: "insensitive"
                                }
                            }
                        }
                    ]
                }
            )
        };

        const [sales, total] = await Promise.all([
            prisma.sale.findMany({
                where,
                include: {
                    agency: true,
                    branch: true,
                    createdBy: true,
                    approvedBy: true,
                    transport: true,
                    items: {
                        include: {
                            product: true,
                            batch: true
                        }
                    }
                },
                orderBy: {
                    createdAt: "desc"
                },
                skip,
                take: limit
            }),
            prisma.sale.count({
                where
            })
        ]);

        return {
            data: sales,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1
            }
        }
    }

    /**
     * =========================================
     * GET SALE BY ID
     * =========================================
     */
    static async getSaleById(
        actor: any,
        saleId: string
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const sale = await prisma.sale.findUnique({
            where: {
                id: saleId
            },
            include: {
                agency: true,
                branch: true,
                transport: true,
                createdBy: true,
                approvedBy: true,
                items: {
                    include: {
                        product: true,
                        batch: true
                    }
                }
            }
        });

        if(!sale) {
            throw new ApiError("Sale not found", 404);
        }

        return sale;
    }

    /**
     * =========================================
     * APPROVE SALE
     * =========================================
    */
    static async approveSale(
        actor: any,
        saleId: string
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const canApprove = await RBACService.hasPermission(
            actor.id,
            "SALE:APPROVE"
        );
        if (!canApprove) {
            throw new ApiError("Forbidden", 403);
        }

        const sale = await prisma.sale.findUnique({
            where: {
                id: saleId
            },
            include: {
                items: true
            }
        });

        if (!sale) {
            throw new ApiError("Sale not found", 404);
        }

        if (sale.status !== "PENDING") {
            throw new ApiError("Only pending sales can be approved", 400);
        }

        /** 
         * Inventory Deduction
         */

        return prisma.$transaction(async (tx) => {

            /**
             * STEP 1:
             * Try locking/claiming approval
             */
            const approvalResult = await tx.sale.updateMany({
                where: {
                    id: saleId,
                    status: "PENDING"
                },
                data: {
                    status: "APPROVED",
                    approvedById: actor.id,
                    approvedAt: sale.createdAt
                }
            });

            /**
             * If count = 0
             * somebody already approved/rejected
             */
            if (approvalResult.count === 0) {
                throw new ApiError(
                    "Sale already processed",
                    409
                );
            }

            const lockedSale = await tx.sale.findUnique({
                where: {
                    id: saleId
                },
                include: {
                    items: true
                }
            });

            if (!lockedSale) {
                throw new ApiError(
                    "Sale not found after locking",
                    404
                );
            }

            const productLedgerCache = new Map<string, { id: string }>();
            const batchIds = [...new Set(lockedSale.items.map(item => item.batchId))];
            const batches = await tx.inventoryBatch.findMany({
                where: {
                    id: {
                        in: batchIds
                    }
                }
            });
            const batchMap = new Map(
                batches.map(batch => [batch.id, batch])
            );

            /**
             * STEP 2:
             * Deduct inventory & Update Product Ledger
             */
            for (const item of lockedSale.items) {

                // Deduct stock from inventory
                await InventoryService.removeStock(tx, {
                    branchId: lockedSale.branchId,
                    productId: item.productId,
                    batchId: item.batchId,
                    quantity: Number(item.quantity),
                    unit: item.unit,
                    transactionDate: lockedSale.createdAt
                });

                // ========================================================
                // PRODUCT LEDGER: Create sale movement entry
                // ========================================================
                // Get or create ProductLedger for this product
                let productLedger = productLedgerCache.get(item.productId);

                if (!productLedger) {
                    productLedger = await ProductLedgerService.getOrCreateProductLedger(
                        item.productId,
                        tx
                    );

                    productLedgerCache.set(item.productId, productLedger);
                }

                // Get the batch details for FIFO traceability
                const batch = batchMap.get(item.batchId);

                if (!batch) {
                    throw new ApiError(`Batch not found for item ${item.productId}`, 404);
                }

                // Create immutable ledger entry for sale movement
                // Batch ID is MANDATORY for FIFO traceability
                await ProductLedgerService.createSaleMovement(tx, {
                    productLedgerId: productLedger.id,
                    sale: lockedSale,
                    saleItem: item,
                    batchId: item.batchId,
                    batchNo: batch.batchNo
                });
            }

            // ========================================================
            // STEP 3: Update Agency Outstanding
            // ========================================================
            // A sale creates an asset/receivable that a customer owes us.
            // We register this by executing an atomic positional check relative to CREDIT.
            // ========================================================
            // STEP 3: Update Agency Outstanding (Race Safe)
            // ========================================================

            const invoiceTotal = Number(lockedSale.grandTotal);

            let existing =
                await tx.agencyOutstanding.findUnique({
                    where: {
                        agencyId_branchId: {
                            agencyId: lockedSale.agencyId,
                            branchId: lockedSale.branchId
                        }
                    }
                });

            if (!existing) {

                try {

                    existing =
                        await tx.agencyOutstanding.create({
                            data: {
                                agencyId: lockedSale.agencyId,
                                branchId: lockedSale.branchId,
                                type: OutstandingType.DEBIT,
                                amount: invoiceTotal,
                                createdAt: lockedSale.createdAt
                            }
                        });

                } catch (err: any) {

                    if (err.code === "P2002") {

                        existing =
                            await tx.agencyOutstanding.findUnique({
                                where: {
                                    agencyId_branchId: {
                                        agencyId: lockedSale.agencyId,
                                        branchId: lockedSale.branchId
                                    }
                                }
                            });

                    } else {

                        throw err;

                    }

                }

            }

            if (!existing) {
                throw new ApiError(
                    "Unable to create Agency Outstanding",
                    500
                );
            }

            let newAmount = Number(existing.amount);
            let currentType = existing.type;

            if (currentType === OutstandingType.DEBIT) {

                newAmount += invoiceTotal;

            } else {

                newAmount -= invoiceTotal;

            }

            if (newAmount < 0) {

                newAmount = Math.abs(newAmount);

                currentType =
                    currentType === OutstandingType.DEBIT
                        ? OutstandingType.CREDIT
                        : OutstandingType.DEBIT;

            }

            await tx.agencyOutstanding.update({
                where: {
                    id: existing.id
                },
                data: {
                    amount: newAmount,
                    type: currentType,
                    updatedAt: lockedSale.createdAt
                }
            });

            await LedgerService.postSaleApproval(tx, lockedSale.id);

            /**
             * STEP 4:
             * Return updated sale
             * Outstanding balance is calculated at runtime by getAgencyOutstanding()
             */
            return lockedSale;

        })
    }

    /**
     * =========================================
     * REJECT SALE
     * =========================================
    */
    static async rejectSale(
        actor: any,
        saleId: string,
        remarks?: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const canReject = await RBACService.hasPermission(
            actor.id,
            "SALE:APPROVE"
        );

        if(!canReject) {
            throw new ApiError("Forbidden", 403);
        }

        const sale = await prisma.sale.findUnique({
            where: {
                id: saleId
            }
        });
        
        if(!sale) {
            throw new ApiError("Sale not found", 404);
        }

        if(sale.status !== "PENDING") {
            throw new ApiError("Only pending sales can be rejected", 400);
        }

        return prisma.sale.update({
            where: {
                id: saleId
            },
            data: {
                status: "REJECTED",
                approvedById: actor.id,
                approvedAt: new Date(),
                remarks: remarks?.trim()
            }
        });
    }

    static async updateSale(
        actor: any,
        saleId: string,
        payload: Partial<CreateSalesPayload>
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const existingSale = await prisma.sale.findUnique({
            where: {
                id: saleId
            },
            include: {
                items: true,
                branch: true,
                agency: true
            }
        });

        if (!existingSale) {
            throw new ApiError("Sale not found", 404);
        }

        if (existingSale.status !== "PENDING") {
            throw new ApiError(
                "Only pending sales can be updated",
                400
            );
        }

        /**
         * Validate items
         */
        if (payload.items && payload.items.length > 0) {

            for (const item of payload.items) {

                if (!item.productId || !item.batchId) {
                    throw new ApiError(
                        "Missing required item fields",
                        400
                    );
                }

                if (item.quantity <= 0) {
                    throw new ApiError(
                        "Invalid item quantity",
                        400
                    );
                }

                if (!item.unit) {
                    throw new ApiError(
                        "Item unit is required",
                        400
                    );
                }
            }
        }

        payload.items = this.mergeDuplicateBatchItems(payload.items || []);

        const updatedSale = await prisma.$transaction(async (tx) => {

            /**
             * Determine branch & agency
             * (new payload value or old existing value)
             */
            const branchId =
                payload.branchId || existingSale.branchId;

            const agencyId =
                payload.agencyId || existingSale.agencyId;

            const branch = await tx.branch.findUnique({
                where: {
                    id: branchId
                }
            });

            if (!branch) {
                throw new ApiError("Branch not found", 404);
            }

            const agency = await tx.agency.findUnique({
                where: {
                    id: agencyId
                }
            });

            if (!agency) {
                throw new ApiError("Agency not found", 404);
            }

            /**
             * GST totals
             */
            let subtotalAmount = 0;
            let totalGSTAmount = 0;

            let totalCGSTAmount = 0;
            let totalSGSTAmount = 0;
            let totalIGSTAmount = 0;

            let grandTotal = 0;

            /**
             * Build updated items
             */
            const itemsData: any[] = [];

            if (payload.items && payload.items.length > 0) {

                for (const item of payload.items) {

                    const batch = await tx.inventoryBatch.findUnique({
                        where: {
                            id: item.batchId
                        },
                        include: {
                            product: true
                        }
                    });

                    if (!batch) {
                        throw new ApiError(
                            `Invalid batch ${item.batchId}`,
                            400
                        );
                    }

                    if (!batch.isActive) {
                        throw new ApiError(
                            `Batch ${batch.batchNo} inactive`,
                            400
                        );
                    }

                    if (batch.productId !== item.productId) {
                        throw new ApiError(
                            "Batch product mismatch",
                            400
                        );
                    }

                    /**
                     * GST calculations
                     */
                    const systemSellingPrice =
                        item.unit === ProductUnit.LTR
                            ? Number(
                                batch.product.sellPriceLTR ||
                                batch.product.sellPricePerUnit
                            )
                            : item.unit === ProductUnit.MT
                            ? Number(batch.product.sellPricePerUnit) * 1000
                            : Number(
                                batch.product.sellPricePerUnit
                            );

                    const sellingPrice =
                        item.unitPrice
                            ? Number(item.unitPrice)
                            : systemSellingPrice;

                    const taxableAmount =
                        item.quantity * sellingPrice;

                    const gstPercent =
                        Number(batch.product.applicableGST) || 0;

                    const isSameState =
                        branch.stateCode &&
                        agency.stateCode &&
                        branch.stateCode === agency.stateCode;

                    let cgstPercent = 0;
                    let sgstPercent = 0;
                    let igstPercent = 0;

                    let cgstAmount = 0;
                    let sgstAmount = 0;
                    let igstAmount = 0;

                    if (isSameState) {

                        cgstPercent = gstPercent / 2;
                        sgstPercent = gstPercent / 2;

                        cgstAmount =
                            (taxableAmount * cgstPercent) / 100;

                        sgstAmount =
                            (taxableAmount * sgstPercent) / 100;

                    } else {

                        igstPercent = gstPercent;

                        igstAmount =
                            (taxableAmount * igstPercent) / 100;
                    }

                    const gstAmount =
                        cgstAmount +
                        sgstAmount +
                        igstAmount;

                    const totalAmount =
                        taxableAmount + gstAmount;

                    /**
                     * Grand totals
                     */
                    subtotalAmount += taxableAmount;

                    totalGSTAmount += gstAmount;

                    totalCGSTAmount += cgstAmount;
                    totalSGSTAmount += sgstAmount;
                    totalIGSTAmount += igstAmount;

                    grandTotal += totalAmount;

                    itemsData.push({
                        saleId,

                        productId: item.productId,
                        batchId: item.batchId,

                        quantity: item.quantity,
                        unit: item.unit,

                        sellingPrice,

                        taxableAmount,

                        gstPercent,

                        cgstPercent,
                        sgstPercent,
                        igstPercent,

                        cgstAmount,
                        sgstAmount,
                        igstAmount,

                        gstAmount,
                        totalAmount
                    });
                }
            }

            /**
             * Update master sale
             */
            await tx.sale.update({
                where: {
                    id: saleId
                },
                data: {

                    agency: {
                        connect: {
                            id: agencyId
                        }
                    },

                    branch: {
                        connect: {
                            id: branchId
                        }
                    },

                    remarks:
                        payload.remarks !== undefined
                            ? payload.remarks.trim()
                            : undefined,

                    invoiceDate:
                        payload.invoiceDate
                            ? new Date(payload.invoiceDate)
                            : undefined,

                    voucherType:
                        "SALE",

                    otherReference:
                        payload.otherReference !== undefined
                            ? payload.otherReference.trim()
                            : undefined,

                    irn:
                        payload.irn !== undefined
                            ? payload.irn.trim()
                            : undefined,

                    ackNo:
                        payload.ackNo !== undefined
                            ? payload.ackNo.trim()
                            : undefined,

                    ackDate:
                        payload.ackDate !== undefined
                            ? payload.ackDate
                                ? new Date(payload.ackDate)
                                : null
                            : undefined,

                    qrCodeImage:
                        payload.qrCodeImage !== undefined
                            ? payload.qrCodeImage.trim()
                            : undefined,

                    modeOfPayment:
                        payload.modeOfPayment !== undefined
                            ? payload.modeOfPayment.trim()
                            : undefined,

                    referenceNo:
                        payload.referenceNo !== undefined
                            ? payload.referenceNo.trim()
                            : undefined,

                    referenceDate:
                        payload.referenceDate !== undefined
                            ? payload.referenceDate
                                ? new Date(payload.referenceDate)
                                : null
                            : undefined,

                    roundOffAmount:
                        payload.roundOffAmount,

                    ...(payload.items && {

                        subTotalAmount: subtotalAmount,

                        totalGSTAmount,

                        totalCGSTAmount,

                        totalSGSTAmount,

                        totalIGSTAmount,

                        grandTotal

                    })

                }
            });

            if (payload.transport) {

                await tx.saleTransport.upsert({

                    where: {
                        saleId
                    },

                    update: {

                        deliveryNote:
                            payload.transport.deliveryNote,

                        buyerOrderNo:
                            payload.transport.buyerOrderNo,

                        buyerOrderDate:
                            payload.transport.buyerOrderDate
                                ? new Date(payload.transport.buyerOrderDate)
                                : null,

                        termsOfDelivery:
                            payload.transport.termsOfDelivery,

                        despatchDocNo:
                            payload.transport.despatchDocNo,

                        despatchDocDate:
                            payload.transport.despatchDocDate
                                ? new Date(payload.transport.despatchDocDate)
                                : null,

                        despatchThrough:
                            payload.transport.despatchThrough,

                        destination:
                            payload.transport.destination,

                        vehicleOrFlightNo:
                            payload.transport.vehicleOrFlightNo,

                        billOfLadingNo:
                            payload.transport.billOfLadingNo,

                        portOfLoading:
                            payload.transport.portOfLoading,

                        portOfDischarge:
                            payload.transport.portOfDischarge,

                        countryTo:
                            payload.transport.countryTo,

                        shippingNo:
                            payload.transport.shippingNo,

                        shippingDate:
                            payload.transport.shippingDate
                                ? new Date(payload.transport.shippingDate)
                                : null,

                        portCode:
                            payload.transport.portCode

                    },

                    create: {

                        saleId,

                        deliveryNote:
                            payload.transport.deliveryNote,

                        buyerOrderNo:
                            payload.transport.buyerOrderNo,

                        buyerOrderDate:
                            payload.transport.buyerOrderDate
                                ? new Date(payload.transport.buyerOrderDate)
                                : undefined,

                        termsOfDelivery:
                            payload.transport.termsOfDelivery,

                        despatchDocNo:
                            payload.transport.despatchDocNo,

                        despatchDocDate:
                            payload.transport.despatchDocDate
                                ? new Date(payload.transport.despatchDocDate)
                                : undefined,

                        despatchThrough:
                            payload.transport.despatchThrough,

                        destination:
                            payload.transport.destination,

                        vehicleOrFlightNo:
                            payload.transport.vehicleOrFlightNo,

                        billOfLadingNo:
                            payload.transport.billOfLadingNo,

                        portOfLoading:
                            payload.transport.portOfLoading,

                        portOfDischarge:
                            payload.transport.portOfDischarge,

                        countryTo:
                            payload.transport.countryTo,

                        shippingNo:
                            payload.transport.shippingNo,

                        shippingDate:
                            payload.transport.shippingDate
                                ? new Date(payload.transport.shippingDate)
                                : undefined,

                        portCode:
                            payload.transport.portCode

                    }

                });

            }

            /**
             * Replace items
             */
            if (payload.items) {

                await tx.salesItem.deleteMany({
                    where: {
                        saleId
                    }
                });

                await tx.salesItem.createMany({
                    data: itemsData
                });
            }

            /**
             * Return updated sale
             */
            return tx.sale.findUnique({
                where: {
                    id: saleId
                },
                include: {
                    agency: true,
                    branch: true,
                    transport: true,
                    createdBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },

                    approvedBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },

                    items: {
                        include: {
                            product: true,
                            batch: true
                        }
                    }
                }
            });
        });

        return updatedSale;
    }


    private static async loadSaleForInvoice(
        saleId: string,
        approvedOnly: boolean
    ) {
        const [sale, invoiceSettings] = await Promise.all([
            prisma.sale.findUnique({
                where: {
                    id: saleId,
                    ...(approvedOnly && {
                        status: "APPROVED"
                    })
                },
                include: {
                    agency: true,
                    branch: {
                        include: {
                            bankAccounts: {
                                where: {
                                    isActive: true
                                },
                                orderBy: {
                                    createdAt: "asc"
                                }
                            }
                        }
                    },
                    transport: true,
                    items: {
                        include: {
                            product: true,
                            batch: true
                        }
                    }
                }
            }),
            prisma.setting.findFirst({
                orderBy: {
                    createdAt: "asc"
                }
            })
        ]);

        return sale
            ? {
                ...sale,
                invoiceSettings
            }
            : null;
    }

    static async downloadInvoicePDF(
        actor: any,
        saleId: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const sale =
            await this.loadSaleForInvoice(
                saleId,
                true
            );

        if(!sale){
            throw new ApiError("Sale not found or is Not Approved", 404);
        }

        const invoiceData = SalesToInvMapper.map(sale);

        const pdf =
            await InvoiceRenderer.generatePdf(
                invoiceData
            );

        return pdf;
    }

    static async previewInvoice(
        actor: any,
        saleId: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const sale =
            await this.loadSaleForInvoice(
                saleId,
                false
            );

        if (!sale) {
            throw new ApiError("Sale not found", 404);
        }

        const data = SalesToInvMapper.map(sale);

        return InvoiceRenderer.generatePdf(
            data
        );
    }
}
