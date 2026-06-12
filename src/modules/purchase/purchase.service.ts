import { OutstandingType, ProductUnit } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { RBACService } from "../rbac/rbac.service";
import { InventoryService } from "../inventory/inventory.service";

type PurchaseItemPayload = {
    productId: string;
    batchNo: string;

    quantity: number;
    unit: ProductUnit;
    purchasePrice: number;
}

type createPurchasePayload = {
    agencyId: string;
    branchId: string;

    invoiceNo: string;
    remarks?: string;

    items: PurchaseItemPayload[];
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
        let totalGSTAmount = 0;
        let grandTotal = 0;

        const processedItems = [];

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
            const gstPercent = Number(product.applicableGST) || 0;

            // taxable amount = quantity * purchase price
            const taxableAmount = Number(item.quantity) * Number(item.purchasePrice);

            // gst amount = taxable amount * gst percent / 100
            const gstAmount = (taxableAmount * gstPercent) / 100;

            // total amount = taxable amount + gst amount
            const totalAmount = taxableAmount + gstAmount;

            subTotalAmount += taxableAmount;
            totalGSTAmount += gstAmount;
            grandTotal += totalAmount;

            processedItems.push({
                productId: item.productId,
                batchNo: item.batchNo,
                quantity: item.quantity,
                unit: item.unit,
                purchasePrice: item.purchasePrice,
                taxableAmount,
                gstPercent,
                gstAmount,
                totalAmount
            })
        }





        /** Create Purchase */
        const purchase = await prisma.purchase.create({
            data: {
                agencyId: payload.agencyId,
                branchId: payload.branchId,
                invoiceNo: normalizedInvoiceNo,
                remarks: payload.remarks?.trim(),

                createdById: actor.id,

                subtotalAmount: subTotalAmount,
                totalGSTAmount: totalGSTAmount,
                grandTotal: grandTotal,

                items: {
                    create: processedItems
                }
            },
            include: {
                agency: true,
                branch: true,
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

            const approvalResult = await tx.purchase.updateMany({
                where: {
                    id: purchaseId,
                    status: "PENDING"
                },
                data: {
                    status: "APPROVED",
                    approvedById: actor.id,
                    approvedAt: new Date()
                }
            });

            if (approvalResult.count === 0) {
                throw new ApiError(
                    "Purchase already processed",
                    409
                );
            }

            const lockedPurchase = await tx.purchase.findUnique({
                where: {
                    id: purchaseId
                },
                include: {
                    items: true
                }
            });

            if(!lockedPurchase){
                throw new ApiError("Purchase not found after locking", 404);
            }


            for (const item of lockedPurchase.items) {

                const batch = await InventoryService.addStock(tx, {
                    branchId: lockedPurchase.branchId,
                    productId: item.productId,
                    batchNo: item.batchNo,
                    quantity: Number(item.quantity),
                    unit: item.unit,
                    purchasePrice: Number(item.purchasePrice)
                });
            }

            /**
             * Outstanding balance is calculated at runtime by getAgencyOutstanding()
             */

            // ========================================================
            // PERSISTENT OUTSTANDING STATE SYNCHRONIZATION HOOK
            // ========================================================
            // A purchase creates a liability/debt that we owe to a vendor.
            // We register this by executing an atomic 'ADD' of a 'DEBIT' position.
            const existing = await tx.agencyOutstanding.findUnique({
                where: {
                    agencyId_branchId: {
                        agencyId: lockedPurchase.agencyId,
                        branchId: lockedPurchase.branchId
                    }
                }
            });

            const invoiceTotal = Number(lockedPurchase.grandTotal);

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
                        agencyId: lockedPurchase.agencyId,
                        branchId: lockedPurchase.branchId,
                        type: OutstandingType.DEBIT,
                        amount: invoiceTotal
                    }
                });
            }
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

        const normalizedInvoiceNo = payload.invoiceNo?.trim().toUpperCase();
        /** Update purchase */
        const updatedPurchase = await prisma.$transaction(async (tx) => {

            let subtotalAmount = 0;
            let totalGSTAmount = 0;
            let grandTotal = 0;

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
                    const gstAmount =
                        (taxableAmount * gstPercent) / 100;

                    /**
                     * Final Total
                     */
                    const totalAmount =
                        taxableAmount + gstAmount;

                    /**
                     * Invoice totals
                     */
                    subtotalAmount += taxableAmount;
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

                        gstAmount,

                        totalAmount
                    });
                }
            }


            // update master
            await tx.purchase.update({
                where: {
                    id: purchaseId
                },
                data: {
                    agencyId: payload.agencyId,
                    branchId: payload.branchId,
                    invoiceNo: normalizedInvoiceNo,
                    remarks: payload.remarks !== undefined ? payload.remarks?.trim() : undefined,
                    subtotalAmount,
                    totalGSTAmount,
                    grandTotal
                }
            });

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