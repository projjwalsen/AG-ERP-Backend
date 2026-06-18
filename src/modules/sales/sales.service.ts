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

type SalesItemPayload = {
    productId: string;
    batchId: string;

    quantity: number;
    unit: ProductUnit;

    unitPrice?: number; // Optional, will auto fetch from product if not provided
}

type CreateSalesPayload = {
    agencyId: string;
    branchId: string;
    remarks?: string;

    /** Invoice Metqadata */
    invoiceDate?: string;
    deliveryNote?: string;

    suppliersRef?: string;
    otherReference?: string;

    buyerOrderNo?: string;
    buyerOrderDate?: string;

    despatchDocNo?: string;
    despatchDocDate?: string;

    despatchThrough?: string;
    destination?: string;

    items: SalesItemPayload[];
}

export class SalesService {

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

        if(
            !payload.items ||
            payload.items.length === 0
        ) {
            throw new ApiError("At least one sales item is required", 400);
        }

        /**
         * Prevent duplicate batch entries
         */
        const salesKeys = new Set();

        for (const item of payload.items) {

            const key = `${item.productId}-${item.batchId}`;

            if (salesKeys.has(key)) {
                throw new ApiError(
                    "Duplicate batch for same product",
                    400
                );
            }

            salesKeys.add(key);
        }

        /** Agency Validation */
        const agency = await prisma.agency.findUnique({
            where: {
                id: payload.agencyId
            }
        });
        if(!agency) {
            throw new ApiError("Invalid Agency Id", 400);
        }

        if(
            agency.type !== "CLIENT" &&
            agency.type !== "BOTH"
        ) {
            throw new ApiError("Agency must be of type CLIENT or BOTH", 400);
        }

        /** Branch Validation */
        const branch = await prisma.branch.findUnique({
            where: {
                id: payload.branchId
            }
        });
        if(!branch) {
            throw new ApiError("Invalid Branch Id", 400);
        }
        if(!branch.isActive){
            throw new ApiError("Branch is not active", 400);
        }

        /** Validate items */
        const validatedItems = [];

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

            const batch = await prisma.inventoryBatch.findUnique({
                where: {
                    id: item.batchId
                },
                include: {
                    product: true
                }
            });

            if (!batch) {
                throw new ApiError(
                    `Invalid Batch Id ${item.batchId}. Not found !`,
                    400
                );
            }

            const setting = await prisma.setting.findFirst();
            const allowNegativeStock = setting?.allowNegativeInventory ?? false;

            if(item.unit === ProductUnit.KG){
                if( 
                    !allowNegativeStock &&
                    Number(batch.availableQtyKG) < Number(item.quantity)
                ) {
                    throw new ApiError(
                        `Insufficient stock in batch ${batch.batchNo}, Available : ${batch.availableQtyKG} KG. Allow negative stock setting.`,
                        400
                    )
                }
            } else {
                if(
                    !allowNegativeStock &&
                    Number(batch.availableQtyLTR) < Number(item.quantity)
                ) {
                    throw new ApiError(
                        `Insufficient stock in batch ${batch.batchNo}, Available : ${batch.availableQtyLTR} LTR. Allow negative stock setting.`,
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
            const taxableAmount = item.quantity * (item.unitPrice ? Number(item.unitPrice) : Number(batch.product.sellPricePerUnit));
            const gstPercent = Number(batch.product.applicableGST) || 0;

            /** GST Type Check */
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

            if(isSameState) {
                cgstPercent = gstPercent / 2;
                sgstPercent = gstPercent / 2;

                cgstAmount = (taxableAmount * cgstPercent) / 100;
                sgstAmount = (taxableAmount * sgstPercent) / 100;
            } else {
                igstPercent = gstPercent;
                igstAmount = (taxableAmount * igstPercent) / 100;
            }

            const gstAmount = cgstAmount + sgstAmount + igstAmount;
            const totalAmount = taxableAmount + gstAmount;

            validatedItems.push({
                item,
                batch,
                product: batch.product,

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
            })

        }

        const firstItem = validatedItems[0];
        const invoiceNo = await this.generateInvoiceNo(
            firstItem.product.name,
            firstItem.batch.batchNo
        );

        let subtotalAmount = 0;
        let totalGSTAmount = 0;

        let totalCGSTAmount = 0;
        let totalSGSTAmount = 0;
        let totalIGSTAmount = 0;

        let grandTotal = 0;

        for(const item of validatedItems) {
            subtotalAmount += item.taxableAmount;

            totalGSTAmount += item.gstAmount;

            totalCGSTAmount += item.cgstAmount;
            totalSGSTAmount += item.sgstAmount;
            totalIGSTAmount += item.igstAmount;

            grandTotal += item.totalAmount;
        }

        /**
         * Create sales record
        */
        const sale = await prisma.sale.create({
            data: {
                agencyId: payload.agencyId,
                branchId: payload.branchId,
                invoiceNo,
                remarks: payload.remarks?.trim(),

                /** Invoice Metadata */
                invoiceDate: payload.invoiceDate ? new Date(payload.invoiceDate) : new Date(),
                deliveryNote: payload.deliveryNote?.trim(),

                suppliersRef: payload.suppliersRef?.trim(),
                otherReference: payload.otherReference?.trim(),

                buyerOrderNo: payload.buyerOrderNo?.trim(),
                buyerOrderDate: payload.buyerOrderDate ? new Date(payload.buyerOrderDate) : undefined,
                
                despatchDocNo: payload.despatchDocNo?.trim(),
                despatchDocDate: payload.despatchDocDate ? new Date(payload.despatchDocDate) : undefined,

                despatchThrough: payload.despatchThrough?.trim(),
                destination: payload.destination?.trim(),

                createdById: actor.id,

                subTotalAmount: subtotalAmount,
                totalGSTAmount,

                totalCGSTAmount,
                totalSGSTAmount,
                totalIGSTAmount,

                grandTotal,

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
                            data.product.sellPricePerUnit,

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

                items: {
                    include: {
                        product: true,
                        batch: true
                    }
                }
            }
        });

        return sale; 
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
        }
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 10;
        const skip = (page - 1) * limit;

        const where: any = {
            ...(
                query?.status && { status: query.status }
            ),
            ...(
                query?.branchId && { branchId: query.branchId }
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
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const canApprove = await RBACService.hasPermission(
            actor.id,
            "SALE:APPROVE"
        );
        if(!canApprove) {
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

        if(!sale) {
            throw new ApiError("Sale not found", 404);
        }

        if(sale.status !== "PENDING") {
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
                    approvedAt: new Date()
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
                    unit: item.unit
                });

                // ========================================================
                // PRODUCT LEDGER: Create sale movement entry
                // ========================================================
                // Get or create ProductLedger for this product
                const productLedger = await ProductLedgerService.getOrCreateProductLedger(
                    item.productId,
                    tx
                );

                // Get the batch details for FIFO traceability
                const batch = await tx.inventoryBatch.findUnique({
                    where: { id: item.batchId }
                });

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
            const existing = await tx.agencyOutstanding.findUnique({
                where: {
                    agencyId_branchId: {
                        agencyId: lockedSale.agencyId,
                        branchId: lockedSale.branchId
                    }
                }
            });

            const invoiceTotal = Number(lockedSale.grandTotal);

            if (existing) {
                let newAmount = Number(existing.amount);
                let currentType = existing.type;

                // Net positional shift calculation relative to DEBIT target
                if (currentType === OutstandingType.DEBIT) {
                    newAmount += invoiceTotal;
                } else {
                    newAmount -= invoiceTotal;
                }

                // If balance drops below zero, invert financial position layout
                if (newAmount < 0) {
                    newAmount = Math.abs(newAmount);
                    currentType = currentType === OutstandingType.DEBIT ? OutstandingType.CREDIT : OutstandingType.DEBIT;
                }

                await tx.agencyOutstanding.update({
                    where: { id: existing.id },
                    data: {
                        amount: newAmount,
                        type: currentType
                    }
                });
            } else {
                // If it's a brand new relationship for this branch, insert standard DEBIT baseline
                await tx.agencyOutstanding.create({
                    data: {
                        agencyId: lockedSale.agencyId,
                        branchId: lockedSale.branchId,
                        type: OutstandingType.DEBIT,
                        amount: invoiceTotal
                    }
                });
            }

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

        /**
         * Prevent duplicate batches
         */
        const salesKeys = new Set();

        for (const item of payload.items || []) {

            const key = `${item.productId}-${item.batchId}`;

            if (salesKeys.has(key)) {
                throw new ApiError(
                    "Duplicate batch for same product",
                    400
                );
            }

            salesKeys.add(key);
        }

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
                    const sellingPrice = Number(
                        batch.product.sellPricePerUnit
                    );

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
                            ? payload.remarks?.trim()
                            : undefined,

                    invoiceDate: payload.invoiceDate ? new Date(payload.invoiceDate) : new Date(),

                    deliveryNote:
                        payload.deliveryNote !== undefined
                            ? payload.deliveryNote?.trim()
                            : undefined,

                    suppliersRef:
                        payload.suppliersRef !== undefined
                            ? payload.suppliersRef?.trim()
                            : undefined,

                    otherReference:
                        payload.otherReference !== undefined
                            ? payload.otherReference?.trim()
                            : undefined,

                    buyerOrderNo:
                        payload.buyerOrderNo !== undefined
                            ? payload.buyerOrderNo?.trim()
                            : undefined,

                    buyerOrderDate:
                        payload.buyerOrderDate !== undefined
                            ? new Date(payload.buyerOrderDate)
                            : undefined,

                    despatchDocNo:
                        payload.despatchDocNo !== undefined
                            ? payload.despatchDocNo?.trim()
                            : undefined,

                    despatchDocDate:
                        payload.despatchDocDate !== undefined
                            ? new Date(payload.despatchDocDate)
                            : undefined,

                    despatchThrough:
                        payload.despatchThrough !== undefined
                            ? payload.despatchThrough?.trim()
                            : undefined,

                    destination:
                        payload.destination !== undefined
                            ? payload.destination?.trim()
                            : undefined,

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


    static async downloadInvoicePDF(
        actor: any,
        saleId: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const sale = await prisma.sale.findUnique({
            where: {
                id: saleId,
                status: "APPROVED"
            },
            include: {
                agency: true,
                branch: true,
                items: {
                    include: {
                        product: true,
                        batch: true
                    }
                }
            }
        });

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

        const sale = await prisma.sale.findUnique({
            where: {
                id: saleId
            },
            include: {
                agency: true,
                branch: true,
                items: {
                    include: {
                        product: true,
                        batch: true
                    }
                }
            }
        });

        const data = SalesToInvMapper.map(sale);

        return InvoiceRenderer.generatePdf(
            data
        );
    }
}
