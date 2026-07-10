import { OutstandingType, ProductUnit, VoucherType } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { RBACService } from "../rbac/rbac.service";
import { InventoryService } from "../inventory/inventory.service";
import { ProductLedgerService } from "../accounting/productLedger/productLedger.service";
import { LedgerService } from "../accounting/ledger/ledger.service";

type PurchaseItemPayload = {
    productId: string;
    batchNo: string;

    quantity: number;
    unit: ProductUnit;
    purchasePrice: number;

    taxableAmount?: number;

    gstPercent?: number;

    cgstAmount?: number;

    sgstAmount?: number;

    igstAmount?: number;

    gstAmount?: number;

    totalAmount?: number;
}

type PurchaseTransportPayload = {

    purchaseOrderNo?: string;

    purchaseOrderDate?: Date | string;

    termsOfDelivery?: string;

    receiptNoteNo?: string;

    receiptNoteDate?: Date | string;

    lrNo?: string;

    dispatchThrough?: string;

    destination?: string;

    vehicleOrFlightNo?: string;

    portOfLoading?: string;

    portOfDischarge?: string;

    countryTo?: string;

    billOfEntryNo?: string;

    billOfEntryDate?: Date | string;

    portCode?: string;

}

type createPurchasePayload = {
    agencyId: string;
    branchId: string;

    invoiceNo: string;
    invoiceDate?: Date | string;
    voucherType?: VoucherType;
    supplierInvoiceDate?: Date | string;
    otherReference?: string;
    remarks?: string;

    roundOffAmount?: number;
    transport?: PurchaseTransportPayload;

    items: PurchaseItemPayload[];
    voucherDate?: Date;
    approvedAt?: Date;
    importedTotals?: {
        subTotal: number;
        totalCGST: number;
        totalSGST: number;
        totalIGST: number;
        totalGST: number;
        roundOff: number;
        grandTotal: number;
    };
}
export class PurchaseService {

    static async createPurchase(
        actor: any,
        payload: createPurchasePayload
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }
        const normalizedInvoiceNo = payload.invoiceNo.trim().toUpperCase();

        if(!payload?.agencyId || !payload?.branchId || !payload?.invoiceNo ){
            throw new ApiError("Missing required purchase fields", 400);
        }

        if(!payload?.items || payload?.items.length === 0){
            throw new ApiError("Purchase items are required", 400);
        }
        /** Validate each items */
        for(const item of payload.items){
            if(!item?.productId || !item?.batchNo){
                throw new ApiError("Missing required item fields", 400);
            }

            if(item?.quantity <= 0){
                throw new ApiError("Invalid item quantity", 400);
            }

            if(item?.purchasePrice < 0){
                throw new ApiError("Invalid item purchase price", 400);
            }

            if(!item?.unit){
                throw new ApiError("Item unit is required", 400);
            }
        }
        /**
         * Prevent duplicate batches in the same purchase
         */
        const batchKeys = new Set();

        for(const item of payload.items){
            const key = `${item.productId}-${item.batchNo.trim()}`;

            if(batchKeys.has(key)){
                throw new ApiError(`Duplicate batch ${item.batchNo} for same product`, 400);
            }
            batchKeys.add(key);
        }

        /**
         * Agency validation
         */
        const agency = await prisma.agency.findUnique({
            where: {
                id: payload.agencyId
            }
        });

        if (!agency) {
            throw new ApiError("Agency not found", 404);
        }

        if (
            agency.type !== "VENDOR" &&
            agency.type !== "BOTH"
        ) {
            throw new ApiError(
                "Selected agency is not a vendor",
                400
            );
        }
        /**
         * Branch validation
         */
        const branch = await prisma.branch.findUnique({
            where: {
                id: payload.branchId
            }
        });

        if (!branch) {
            throw new ApiError("Branch not found", 404);
        }

        if (!branch.isActive) {
            throw new ApiError(
                "Branch is inactive",
                400
            );
        }
        /** Invoice validation */
        const existingInvoice = await prisma.purchase.findFirst({
            where: {
                branchId: payload.branchId,
                agencyId: payload.agencyId,
                invoiceNo: normalizedInvoiceNo
            }
        });

        if (existingInvoice) {
            throw new ApiError(
                "Purchase invoice already exists",
                400
            );
        }

        /** Calculate the GST + Totals amounts */
        let subTotalAmount = 0;

        let totalCGSTAmount = 0;

        let totalSGSTAmount = 0;

        let totalIGSTAmount = 0;

        let totalGSTAmount = 0;

        let grandTotal = 0;

        const roundOffAmount =
            payload.roundOffAmount ?? 0;

        const processedItems = [];
        const money = (v: number) =>
            Math.round(v * 100) / 100;

        for(const item of payload.items){
            if(!item.productId || !item.batchNo){
                throw new ApiError("Missing required item fields", 400);
            }

            if(item.quantity <= 0){
                throw new ApiError("Invalid item quantity", 400);
            }

            if(item.purchasePrice < 0){
                throw new ApiError("Invalid item purchase price", 400);
            }


            const product = await prisma.product.findUnique({
                where: {
                    id: item.productId
                }
            });

            if(!product){
                throw new ApiError(`Product not found for ID ${item.productId}`, 404);
            }

            // product gst percent
            const gstPercent =
                payload.importedTotals
                    ? Number(item.gstPercent ?? 0)
                    : Number(product.applicableGST) || 0;

            // taxable amount = quantity * purchase price
            

            const taxableAmount =
                payload.importedTotals
                    ? Number(item.taxableAmount ?? 0)
                    : money(
                        Number(item.quantity) *
                        Number(item.purchasePrice)
                    );

            let cgstAmount = 0;
            let sgstAmount = 0;
            let igstAmount = 0;
            let gstAmount = 0;
            let totalAmount = 0;

            if (payload.importedTotals) {

                cgstAmount = money(Number(item.cgstAmount ?? 0));

                sgstAmount = money(Number(item.sgstAmount ?? 0));

                igstAmount = money(Number(item.igstAmount ?? 0));

                gstAmount = money(Number(item.gstAmount ?? 0));

                totalAmount = money(Number(item.totalAmount ?? 0));

            } else {

                if (agency.stateCode === branch.stateCode) {

                    cgstAmount = money(
                        (taxableAmount * gstPercent) / 200
                    );

                    sgstAmount = money(
                        (taxableAmount * gstPercent) / 200
                    );

                } else {

                    igstAmount = money(
                        (taxableAmount * gstPercent) / 100
                    );

                }

                gstAmount = money(
                    cgstAmount +
                    sgstAmount +
                    igstAmount
                );

                totalAmount = money(
                    taxableAmount +
                    gstAmount
                );
            }

            subTotalAmount = money(
                subTotalAmount + taxableAmount
            );

            totalCGSTAmount = money(
                totalCGSTAmount + cgstAmount
            );

            totalSGSTAmount = money(
                totalSGSTAmount + sgstAmount
            );

            totalIGSTAmount = money(
                totalIGSTAmount + igstAmount
            );

            totalGSTAmount = money(
                totalGSTAmount + gstAmount
            );

            processedItems.push({
                productId: item.productId,
                batchNo: item.batchNo,
                quantity: item.quantity,
                unit: item.unit,
                purchasePrice: money(item.purchasePrice),

                taxableAmount,

                gstPercent,

                gstAmount,

                totalAmount
            });
        }

        if (payload.importedTotals) {
            subTotalAmount =
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

            grandTotal = money(
                subTotalAmount +
                totalGSTAmount +
                roundOffAmount
            );

        }

        if (
            payload.importedTotals &&
            totalGSTAmount === 0 &&
            grandTotal > subTotalAmount
        ) {

            totalGSTAmount = Number(
                (grandTotal - subTotalAmount - roundOffAmount)
                    .toFixed(2)
            );

            const sameState =
                agency.stateCode === branch.stateCode;

            if (sameState) {

                totalCGSTAmount = Number(
                    (totalGSTAmount / 2).toFixed(2)
                );

                totalSGSTAmount = Number(
                    (
                        totalGSTAmount -
                        totalCGSTAmount
                    ).toFixed(2)
                );

                totalIGSTAmount = 0;

            } else {

                totalIGSTAmount = totalGSTAmount;

                totalCGSTAmount = 0;

                totalSGSTAmount = 0;

            }

        }


        /** Create Purchase */
        const purchase = await prisma.purchase.create({
            data:{

                agencyId: payload.agencyId,

                branchId: payload.branchId,

                invoiceNo: normalizedInvoiceNo,

                invoiceDate:
                    payload.invoiceDate
                    ? new Date(payload.invoiceDate)
                    : new Date(),

                supplierInvoiceDate:
                    payload.supplierInvoiceDate
                    ? new Date(payload.supplierInvoiceDate)
                    : undefined,

                voucherType:"PURCHASE",

                otherReference:
                    payload.otherReference,

                remarks:
                    payload.remarks,

                subtotalAmount:subTotalAmount,

                totalCGSTAmount,

                totalSGSTAmount,

                totalIGSTAmount,

                totalGSTAmount,

                roundOffAmount,

                grandTotal,

                createdById:actor.id,
                createdAt:
                    payload.voucherDate
                        ? new Date(payload.voucherDate)
                        : new Date(),


                transport:

                    payload.transport
                    ?{

                        create:{

                            ...payload.transport,

                            purchaseOrderDate:
                                payload.transport.purchaseOrderDate
                                ? new Date(
                                    payload.transport.purchaseOrderDate
                                )
                                :undefined,

                            receiptNoteDate:
                                payload.transport.receiptNoteDate
                                ? new Date(
                                    payload.transport.receiptNoteDate
                                )
                                :undefined,

                            billOfEntryDate:
                                payload.transport.billOfEntryDate
                                ? new Date(
                                    payload.transport.billOfEntryDate
                                )
                                :undefined

                        }

                    }

                    :undefined,

                items:{
                    create:processedItems
                }

            },
            include: {
                agency: true,
                branch: true,
                transport: true,
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        return purchase;
    }

    static async getAllPurchases(
        actor: any,
        query?: {
            page?: number;
            limit?: number;
            status?: "PENDING" | "APPROVED" | "REJECTED";
            branchId?: string;
        }
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 10;

        const skip = (page - 1) * limit;

        const where = {
            ...(query?.status && {
                status: query.status
            }),
            ...(query?.branchId && {
                branchId: query.branchId
            })
        }
        
        const [purchases, total] = await Promise.all([
            prisma.purchase.findMany({
                where,
                include: {
                    agency: {
                        select: {
                            id: true,
                            name: true,
                            type: true
                        }
                    },

                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true
                        }
                    },
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
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    sku: true,
                                    hsnNo: true,
                                    applicableGST: true
                                }
                            },
                        }
                    }
                },
                orderBy: {
                    createdAt: "desc"
                },
                skip,
                take: limit
            }),

            prisma.purchase.count({
                where
            })
        ]);

        return {
            data: purchases.map((purchase) => ({
                ...purchase,

                subtotalAmount: Number(
                    purchase.subtotalAmount
                ),

                totalGSTAmount: Number(
                    purchase.totalGSTAmount
                ),

                

                grandTotal: Number(
                    purchase.grandTotal
                ),

                items: purchase.items.map((item) => ({
                    ...item,

                    quantity: Number(item.quantity),
                    purchasePrice: Number(item.purchasePrice),

                    taxableAmount: Number(
                        item.taxableAmount
                    ),

                    gstPercent: Number(
                        item.gstPercent
                    ),

                    gstAmount: Number(
                        item.gstAmount
                    ),

                    totalAmount: Number(
                        item.totalAmount
                    )
                }))
            })),
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

    static async getPurchaseById(
        actor: any,
        purchaseId: string
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const purchase = await prisma.purchase.findUnique({
            where: {
                id: purchaseId
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
                transport: true,

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

        if(!purchase){
            throw new ApiError("Purchase not found", 404);
        }

        return {
            ...purchase,

            subtotalAmount: Number(
                purchase.subtotalAmount
            ),

            totalGSTAmount: Number(
                purchase.totalGSTAmount
            ),

            grandTotal: Number(
                purchase.grandTotal
            ),

            items: purchase.items.map((item) => ({
                ...item,

                quantity: Number(item.quantity),
                purchasePrice: Number(item.purchasePrice),

                taxableAmount: Number(
                    item.taxableAmount
                ),

                gstPercent: Number(
                    item.gstPercent
                ),

                gstAmount: Number(
                    item.gstAmount
                ),

                totalAmount: Number(
                    item.totalAmount
                )
            }))
        };
    }

    static async approvePurchase(
        actor: any,
        purchaseId: string
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const canApprove = await RBACService.hasPermission(
            actor.id,
            "PURCHASE:APPROVE"
        );

        if(!canApprove){
            throw new ApiError("You do not have permission to approve purchase", 403);
        }

        const purchase = await prisma.purchase.findUnique({
            where: {
                id: purchaseId
            },
            include: {
                items: true
            }
        });

        if(!purchase){
            throw new ApiError("Purchase not found", 404);
        }

        if(purchase.status !== "PENDING"){
            throw new ApiError("Purchase already processed", 400);
        }
        
        /** Inventory Update */
        return prisma.$transaction(async (tx) => {
            const lockedPurchase = await tx.purchase.findUnique({
                where: {
                    id: purchaseId
                },
                include: {
                    items: true
                }
            });
            
            const approvalResult = await tx.purchase.updateMany({
                where: {
                    id: purchaseId,
                    status: "PENDING"
                },
                data: {
                    status: "APPROVED",
                    approvedById: actor.id,
                    approvedAt: purchase.createdAt
                }
            });

            if (approvalResult.count === 0) {
                throw new ApiError(
                    "Purchase already processed",
                    409
                );
            }


            if(!lockedPurchase){
                throw new ApiError("Purchase not found after locking", 404);
            }

            // ========================================================
            // STEP 1: Update Inventory & Product Ledger
            // ========================================================
            for (const item of lockedPurchase.items) {

                // Add stock to inventory
                const batch = await InventoryService.addStock(tx, {
                    branchId: lockedPurchase.branchId,
                    productId: item.productId,
                    batchNo: item.batchNo,
                    quantity: Number(item.quantity),
                    unit: item.unit,
                    purchasePrice: Number(item.purchasePrice),
                    transactionDate: purchase.createdAt
                });

                // ========================================================
                // PRODUCT LEDGER: Create inventory movement entry
                // ========================================================
                // Get or create ProductLedger for this product
                const productLedger = await ProductLedgerService.getOrCreateProductLedger(
                    item.productId,
                    tx
                );

                // Create immutable ledger entry for purchase movement
                await ProductLedgerService.createPurchaseMovement(tx, {
                    productLedgerId: productLedger.id,
                    purchase: lockedPurchase,
                    purchaseItem: item,
                    batchId: batch.id,
                    batchNo: item.batchNo
                });
            }

            /**
             * Outstanding balance is calculated at runtime by getAgencyOutstanding()
             */

            // ========================================================
            // STEP 2: Update Agency Outstanding
            // ========================================================
            // A purchase creates a liability/debt that we owe to a vendor.
            // We register this by executing an atomic 'ADD' of a 'DEBIT' position.
            // ========================================================
            // STEP 3: Update Agency Outstanding (Race Safe)
            // ========================================================

            const invoiceTotal = Number(lockedPurchase.grandTotal);

            let existing =
                await tx.agencyOutstanding.findUnique({
                    where: {
                        agencyId_branchId: {
                            agencyId: lockedPurchase.agencyId,
                            branchId: lockedPurchase.branchId
                        }
                    }
                });

            if (!existing) {

                try {

                    existing =
                        await tx.agencyOutstanding.create({
                            data: {
                                agencyId: lockedPurchase.agencyId,
                                branchId: lockedPurchase.branchId,
                                type: OutstandingType.DEBIT,
                                amount: invoiceTotal,
                                createdAt: lockedPurchase.createdAt
                            }
                        });

                } catch (err: any) {

                    if (err.code === "P2002") {

                        existing =
                            await tx.agencyOutstanding.findUnique({
                                where: {
                                    agencyId_branchId: {
                                        agencyId: lockedPurchase.agencyId,
                                        branchId: lockedPurchase.branchId
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
                    updatedAt: lockedPurchase.createdAt
                }
            });

            await LedgerService.postPurchaseApproval(tx, lockedPurchase.id);

            return lockedPurchase;
        });
    }

    static async rejectPurchase(
        actor: any,
        purchaseId: string,
        remarks?: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const canReject = await RBACService.hasPermission(
            actor.id,
            "PURCHASE:APPROVE"
        );

        if(!canReject){
            throw new ApiError("You do not have permission to reject purchase", 403);
        }

        const purchase = await prisma.purchase.findUnique({
            where: {
                id: purchaseId
            }
        });

        if(!purchase){
            throw new ApiError("Purchase not found", 404);
        }

        if(purchase.status !== "PENDING"){
            throw new ApiError("Only pending purchase can be rejected", 400);
        }

        return prisma.purchase.update({
            where: {
                id: purchaseId
            },
            data: {
                status: "REJECTED",
                approvedById: actor.id,
                approvedAt: new Date(),
                remarks
            }
        });
    }

    static async updatePurchase(
        actor: any,
        purchaseId: string,
        payload: Partial<createPurchasePayload>
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        /** Only pending purcvhase can be updated */
        const existingPurchase = await prisma.purchase.findUnique({
            where: {
                id: purchaseId
            },
            include: {
                items: true
            }
        });

        if(!existingPurchase){
            throw new ApiError("Purchase not found", 404);
        }

        if(existingPurchase.status !== "PENDING"){
            throw new ApiError("Only pending purchase can be updated", 400);
        }

        // Implementation for updating purchase
        if(payload.items && payload.items.length > 0){
            /** Validate each items */
            for(const item of payload.items){
                if(!item.productId  ||
                    !item.batchNo
                ) {
                    throw new ApiError("Missing required item fields", 400);
                }

                if(item.quantity <= 0){
                    throw new ApiError("Invalid item quantity", 400);
                }

                if(item.purchasePrice < 0){
                    throw new ApiError("Invalid item purchase price", 400);
                }

                if(!item.unit){
                    throw new ApiError("Item unit is required", 400);
                }
            }
        }

        const normalizedInvoiceNo =
            payload.invoiceNo
                ? payload.invoiceNo.trim().toUpperCase()
                : existingPurchase.invoiceNo;

        /** Update purchase */
        const updatedPurchase = await prisma.$transaction(async (tx) => {

            const agency = await tx.agency.findUnique({
                where: {
                    id: payload.agencyId ?? existingPurchase.agencyId
                }
            });

            if (!agency) {
                throw new ApiError("Agency not found", 404);
            }

            const branch = await tx.branch.findUnique({
                where: {
                    id: payload.branchId ?? existingPurchase.branchId
                }
            });

            if (!branch) {
                throw new ApiError("Branch not found", 404);
            }

            let subTotalAmount = 0;

            let totalCGSTAmount = 0;

            let totalSGSTAmount = 0;

            let totalIGSTAmount = 0;

            let totalGSTAmount = 0;

            let grandTotal = 0;

            const roundOffAmount =
                payload.roundOffAmount ?? 0;

            const itemsData = [];

            if (payload.items && payload.items.length > 0) {

                for (const item of payload.items) {

                    /**
                     * Fetch product for GST
                     */
                    const product = await tx.product.findUnique({
                        where: {
                            id: item.productId
                        }
                    });

                    if (!product) {
                        throw new ApiError(
                            `Product not found: ${item.productId}`,
                            404
                        );
                    }

                    const quantity = Number(item.quantity);
                    const purchasePrice = Number(item.purchasePrice);

                    /**
                     * Taxable Amount
                     */
                    const taxableAmount =
                        quantity * purchasePrice;

                    /**
                     * GST %
                     */
                    const gstPercent = Number(
                        product.applicableGST || 0
                    );

                    /**
                     * GST Amount
                     */
                    let cgstPercent = 0;

                    let sgstPercent = 0;

                    let igstPercent = 0;

                    if (agency.stateCode === branch.stateCode) {

                        cgstPercent = gstPercent / 2;

                        sgstPercent = gstPercent / 2;

                    } else {

                        igstPercent = gstPercent;

                    }

                    const cgstAmount =
                        (taxableAmount * cgstPercent) / 100;

                    const sgstAmount =
                        (taxableAmount * sgstPercent) / 100;

                    const igstAmount =
                        (taxableAmount * igstPercent) / 100;

                    const gstAmount =
                        cgstAmount +
                        sgstAmount +
                        igstAmount;

                    /**
                     * Final Total
                     */
                    const totalAmount =
                        taxableAmount + gstAmount;

                    /**
                     * Invoice totals
                     */
                    subTotalAmount += taxableAmount;

                    totalCGSTAmount += cgstAmount;

                    totalSGSTAmount += sgstAmount;

                    totalIGSTAmount += igstAmount;

                    totalGSTAmount += gstAmount;

                    grandTotal += totalAmount;

                    itemsData.push({

                        purchaseId,

                        productId: item.productId,

                        batchNo: item.batchNo,

                        quantity: item.quantity,

                        unit: item.unit,

                        purchasePrice: item.purchasePrice,

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
                grandTotal += roundOffAmount;
            }


            // update master
            await tx.purchase.update({
                where: {
                    id: purchaseId
                },
                data: {

                    agencyId:
                        payload.agencyId,

                    branchId:
                        payload.branchId,

                    invoiceNo:
                        normalizedInvoiceNo,

                    invoiceDate:
                        payload.invoiceDate
                            ? new Date(payload.invoiceDate)
                            : undefined,

                    supplierInvoiceDate:
                        payload.supplierInvoiceDate
                            ? new Date(payload.supplierInvoiceDate)
                            : undefined,

                    voucherType:
                        "PURCHASE",

                    otherReference:
                        payload.otherReference,

                    remarks:
                        payload.remarks !== undefined
                            ? payload.remarks.trim()
                            : undefined,

                    subtotalAmount:
                        subTotalAmount,

                    totalCGSTAmount,

                    totalSGSTAmount,

                    totalIGSTAmount,

                    totalGSTAmount,

                    roundOffAmount,

                    grandTotal

                }
            });

            if (payload.transport) {

                await tx.purchaseTransport.upsert({

                    where: {

                        purchaseId

                    },

                    create: {

                        purchaseId,

                        purchaseOrderNo:
                            payload.transport.purchaseOrderNo,

                        purchaseOrderDate:
                            payload.transport.purchaseOrderDate
                                ? new Date(payload.transport.purchaseOrderDate)
                                : undefined,

                        termsOfDelivery:
                            payload.transport.termsOfDelivery,

                        receiptNoteNo:
                            payload.transport.receiptNoteNo,

                        receiptNoteDate:
                            payload.transport.receiptNoteDate
                                ? new Date(payload.transport.receiptNoteDate)
                                : undefined,

                        lrNo:
                            payload.transport.lrNo,

                        dispatchThrough:
                            payload.transport.dispatchThrough,

                        destination:
                            payload.transport.destination,

                        vehicleOrFlightNo:
                            payload.transport.vehicleOrFlightNo,

                        portOfLoading:
                            payload.transport.portOfLoading,

                        portOfDischarge:
                            payload.transport.portOfDischarge,

                        countryTo:
                            payload.transport.countryTo,

                        billOfEntryNo:
                            payload.transport.billOfEntryNo,

                        billOfEntryDate:
                            payload.transport.billOfEntryDate
                                ? new Date(payload.transport.billOfEntryDate)
                                : undefined,

                        portCode:
                            payload.transport.portCode

                    },

                    update: {

                        purchaseOrderNo:
                            payload.transport.purchaseOrderNo,

                        purchaseOrderDate:
                            payload.transport.purchaseOrderDate
                                ? new Date(payload.transport.purchaseOrderDate)
                                : undefined,

                        termsOfDelivery:
                            payload.transport.termsOfDelivery,

                        receiptNoteNo:
                            payload.transport.receiptNoteNo,

                        receiptNoteDate:
                            payload.transport.receiptNoteDate
                                ? new Date(payload.transport.receiptNoteDate)
                                : undefined,

                        lrNo:
                            payload.transport.lrNo,

                        dispatchThrough:
                            payload.transport.dispatchThrough,

                        destination:
                            payload.transport.destination,

                        vehicleOrFlightNo:
                            payload.transport.vehicleOrFlightNo,

                        portOfLoading:
                            payload.transport.portOfLoading,

                        portOfDischarge:
                            payload.transport.portOfDischarge,

                        countryTo:
                            payload.transport.countryTo,

                        billOfEntryNo:
                            payload.transport.billOfEntryNo,

                        billOfEntryDate:
                            payload.transport.billOfEntryDate
                                ? new Date(payload.transport.billOfEntryDate)
                                : undefined,

                        portCode:
                            payload.transport.portCode

                    }

                });

            }

            if(payload.items){
                // delete existing items
                await tx.purchaseItem.deleteMany({
                    where: {
                        purchaseId
                    }
                });

                // create new items
                await tx.purchaseItem.createMany({
                    data: itemsData
                });
            }

            return tx.purchase.findUnique({
                where: {
                    id: purchaseId
                },
                include: {
                    transport: true,
                    agency: {
                        select: {
                            id: true,
                            name: true,
                            type: true
                        }
                    },
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true
                        }
                    },
                    createdBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },
                    items: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    sku: true,
                                    hsnNo: true,
                                    applicableGST: true
                                }
                            },
                            batch: true
                        }
                    }
                }
            })
        });

        return updatedPurchase;
    }
}
