import {
    Prisma,
    ProductUnit,
    PurchaseOrderStatus
} from "@prisma/client";

import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { RBACService } from "../rbac/rbac.service";
import { PurchaseService } from "../purchase/purchase.service";
import { PurchaseOrderRenderer } from "../../core/utils/PORender";
import { formatISTDateOnly } from "../../core/utils/loc.utils";

/* ============================================================
 * TYPES
 * ============================================================ */

type PurchaseOrderItemPayload = {
    productId: string;
    quantity: number;
    unit: ProductUnit;
    purchasePrice: number;
};

type CreatePurchaseOrderPayload = {
    agencyId: string;
    branchId: string;

    remarks?: string;

    items: PurchaseOrderItemPayload[];
};

type ListPurchaseOrderQuery = {
    page?: number;
    limit?: number;

    agencyId?: string;
    branchId?: string;

    status?: PurchaseOrderStatus;

    search?: string;
};

type CreatePurchaseFromOrderPayload = {

    invoiceNo: string;

    invoiceDate?: Date | string;

    supplierInvoiceDate?: Date | string;

    otherReference?: string;

    remarks?: string;

    roundOffAmount?: number;

    transport?: {
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
    };

    items: {
        productId: string;
        batchNo: string;

        quantity: number;
        unit: ProductUnit;
        purchasePrice: number;
    }[];
};

/* ============================================================
 * HELPERS
 * ============================================================ */

const money = (value: unknown) =>
    Math.round(Number(value || 0) * 100) / 100;

const quantity = (value: unknown) =>
    Math.round(Number(value || 0) * 1000) / 1000;


const includePurchaseOrderDetails = {

    agency: true,

    branch: true,

    createdBy: {
        select: {
            id: true,
            name: true
        }
    },

    approvedBy: {
        select: {
            id: true,
            name: true
        }
    },

    items: {
        include: {
            product: true
        }
    },

    purchases: {
        select: {
            id: true,
            invoiceNo: true,
            invoiceDate: true,
            grandTotal: true,
            status: true
        }
    }

} satisfies Prisma.PurchaseOrderInclude;


/* ============================================================
 * SERVICE
 * ============================================================ */

export class PurchaseOrderService {

    private static formatMoney(
        value: unknown
    ) {
        return Number(value || 0)
            .toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
    }
    /* --------------------------------------------------------
     * PERMISSION
     * -------------------------------------------------------- */

    private static async ensurePermission(
        actor: any,
        permission: string
    ) {

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        const allowed =
            await RBACService.hasPermission(
                actor.id,
                permission
            );

        if (!allowed) {
            throw new ApiError(
                "Forbidden",
                403
            );
        }
    }


    /* --------------------------------------------------------
     * BRANCH ACCESS
     * -------------------------------------------------------- */

    private static validateBranchAccess(
        actor: any,
        branchId: string
    ) {

        if (
            actor.branchAccessType !== "ALL" &&
            actor.branchId !== branchId
        ) {
            throw new ApiError(
                "You do not have access to this branch",
                403
            );
        }
    }


    /* --------------------------------------------------------
     * PO NUMBER
     *
     * Example:
     * PO-2026-000001
     * -------------------------------------------------------- */

    private static async generatePONo(
        tx: Prisma.TransactionClient
    ) {

        const year =
            new Date().getFullYear();

        const prefix =
            `PO-${year}-`;

        const latest =
            await tx.purchaseOrder.findFirst({

                where: {
                    poNo: {
                        startsWith: prefix
                    }
                },

                select: {
                    poNo: true
                },

                orderBy: {
                    poNo: "desc"
                }
            });

        let sequence = 1;

        if (latest) {

            const last =
                Number(
                    latest.poNo.split("-").pop()
                );

            if (Number.isFinite(last)) {
                sequence = last + 1;
            }
        }

        return (
            `${prefix}` +
            String(sequence).padStart(6, "0")
        );
    }


    /* --------------------------------------------------------
     * NORMALIZE ITEMS
     * -------------------------------------------------------- */

    private static async normalizeItems(
        tx: Prisma.TransactionClient,
        items?: PurchaseOrderItemPayload[]
    ) {

        if (!items?.length) {
            throw new ApiError(
                "Purchase order items are required",
                400
            );
        }

        const productIds =
            [...new Set(
                items.map(item => item.productId)
            )];

        if (productIds.length !== items.length) {
            throw new ApiError(
                "Same product cannot be added multiple times to one purchase order",
                400
            );
        }

        const products =
            await tx.product.findMany({

                where: {
                    id: {
                        in: productIds
                    },
                    isActive: true
                },

                select: {
                    id: true,
                    name: true,
                    baseUnit: true
                }
            });

        if (products.length !== productIds.length) {
            throw new ApiError(
                "One or more selected products are invalid or inactive",
                400
            );
        }

        return items.map(
            (item, index) => {

                const qty =
                    quantity(item.quantity);

                const price =
                    money(item.purchasePrice);

                if (!item.productId) {
                    throw new ApiError(
                        `Product is required for item ${index + 1}`,
                        400
                    );
                }

                if (qty <= 0) {
                    throw new ApiError(
                        `Quantity must be greater than zero for item ${index + 1}`,
                        400
                    );
                }

                if (price < 0) {
                    throw new ApiError(
                        `Purchase price cannot be negative for item ${index + 1}`,
                        400
                    );
                }

                if (
                    !item.unit ||
                    !Object.values(ProductUnit)
                        .includes(item.unit)
                ) {
                    throw new ApiError(
                        `Valid unit is required for item ${index + 1}`,
                        400
                    );
                }

                return {
                    productId:
                        item.productId,

                    quantity:
                        qty,

                    unit:
                        item.unit,

                    purchasePrice:
                        price,

                    totalAmount:
                        money(qty * price)
                };
            }
        );
    }


    /* ========================================================
     * CREATE PURCHASE ORDER
     * ======================================================== */

    static async createPurchaseOrder(
        actor: any,
        payload: CreatePurchaseOrderPayload
    ) {

        await this.ensurePermission(
            actor,
            "PURCHASE:WRITE"
        );

        if (
            !payload.agencyId ||
            !payload.branchId
        ) {
            throw new ApiError(
                "Agency ID and Branch ID are required",
                400
            );
        }

        this.validateBranchAccess(
            actor,
            payload.branchId
        );

        return prisma.$transaction(
            async tx => {

                /* ---------------- VENDOR ---------------- */

                const agency =
                    await tx.agency.findUnique({
                        where: {
                            id: payload.agencyId
                        }
                    });

                if (!agency) {
                    throw new ApiError(
                        "Agency not found",
                        404
                    );
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

                if (!agency.isActive) {
                    throw new ApiError(
                        "Selected vendor is inactive",
                        400
                    );
                }


                /* ---------------- BRANCH ---------------- */

                const branch =
                    await tx.branch.findUnique({
                        where: {
                            id: payload.branchId
                        }
                    });

                if (!branch) {
                    throw new ApiError(
                        "Branch not found",
                        404
                    );
                }

                if (!branch.isActive) {
                    throw new ApiError(
                        "Branch is inactive",
                        400
                    );
                }


                /* ---------------- ITEMS ---------------- */

                const items =
                    await this.normalizeItems(
                        tx,
                        payload.items
                    );


                /* ---------------- TOTAL ---------------- */

                const subtotalAmount =
                    money(
                        items.reduce(
                            (sum, item) =>
                                sum +
                                item.totalAmount,
                            0
                        )
                    );


                /* ---------------- NUMBER ---------------- */

                const poNo =
                    await this.generatePONo(tx);


                /* ---------------- CREATE ---------------- */

                return tx.purchaseOrder.create({

                    data: {

                        poNo,

                        poDate:
                            new Date(),

                        agencyId:
                            payload.agencyId,

                        branchId:
                            payload.branchId,

                        subtotalAmount,

                        remarks:
                            payload.remarks?.trim() ||
                            null,

                        status:
                            PurchaseOrderStatus.PENDING,

                        createdById:
                            actor.id,

                        items: {
                            create: items
                        }
                    },

                    include:
                        includePurchaseOrderDetails
                });
            }
        );
    }


    /* ========================================================
     * APPROVE PURCHASE ORDER
     *
     * IMPORTANT:
     *
     * NO inventory
     * NO InventoryBatch
     * NO ProductLedger
     * NO AgencyOutstanding
     * NO accounting Voucher
     *
     * PO is not an accounting transaction.
     * ======================================================== */

    static async approvePurchaseOrder(
        actor: any,
        purchaseOrderId: string
    ) {

        await this.ensurePermission(
            actor,
            "PURCHASE:APPROVE"
        );

        return prisma.$transaction(
            async tx => {

                const po =
                    await tx.purchaseOrder.findUnique({

                        where: {
                            id: purchaseOrderId
                        },

                        include: {
                            items: true
                        }
                    });

                if (!po) {
                    throw new ApiError(
                        "Purchase order not found",
                        404
                    );
                }

                this.validateBranchAccess(
                    actor,
                    po.branchId
                );

                if (
                    po.status !==
                    PurchaseOrderStatus.PENDING
                ) {
                    throw new ApiError(
                        "Only pending purchase orders can be approved",
                        400
                    );
                }

                const result =
                    await tx.purchaseOrder.updateMany({

                        where: {
                            id: po.id,
                            status:
                                PurchaseOrderStatus.PENDING
                        },

                        data: {
                            status:
                                PurchaseOrderStatus.APPROVED,

                            approvedById:
                                actor.id,

                            approvedAt:
                                new Date()
                        }
                    });

                if (!result.count) {
                    throw new ApiError(
                        "Purchase order already processed",
                        409
                    );
                }

                return tx.purchaseOrder.findUnique({

                    where: {
                        id: po.id
                    },

                    include:
                        includePurchaseOrderDetails
                });
            }
        );
    }


    /* ========================================================
     * REJECT
     * ======================================================== */

    static async rejectPurchaseOrder(
        actor: any,
        purchaseOrderId: string,
        remarks?: string
    ) {

        await this.ensurePermission(
            actor,
            "PURCHASE:APPROVE"
        );

        const po =
            await prisma.purchaseOrder.findUnique({
                where: {
                    id: purchaseOrderId
                }
            });

        if (!po) {
            throw new ApiError(
                "Purchase order not found",
                404
            );
        }

        this.validateBranchAccess(
            actor,
            po.branchId
        );

        if (
            po.status !==
            PurchaseOrderStatus.PENDING
        ) {
            throw new ApiError(
                "Only pending purchase orders can be rejected",
                400
            );
        }

        return prisma.purchaseOrder.update({

            where: {
                id: po.id
            },

            data: {

                status:
                    PurchaseOrderStatus.REJECTED,

                approvedById:
                    actor.id,

                rejectedAt:
                    new Date(),

                rejectionRemarks:
                    remarks?.trim() ||
                    null
            },

            include:
                includePurchaseOrderDetails
        });
    }


    /* ========================================================
     * GET BY ID
     * ======================================================== */

    static async getPurchaseOrderById(
        actor: any,
        purchaseOrderId: string
    ) {

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        await this.ensurePermission(
            actor,
            "PURCHASE:VIEW"
        );

        const po =
            await prisma.purchaseOrder.findUnique({

                where: {
                    id: purchaseOrderId
                },

                include:
                    includePurchaseOrderDetails
            });

        if (!po) {
            throw new ApiError(
                "Purchase order not found",
                404
            );
        }

        this.validateBranchAccess(
            actor,
            po.branchId
        );

        return po;
    }


    /* ========================================================
     * LIST
     * ======================================================== */

    static async listPurchaseOrders(
        actor: any,
        query: ListPurchaseOrderQuery = {}
    ) {

        await this.ensurePermission(
            actor,
            "PURCHASE:VIEW"
        );

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        const page =
            Math.max(
                Number(query.page) || 1,
                1
            );

        const limit =
            Math.min(
                Math.max(
                    Number(query.limit) || 10,
                    1
                ),
                100
            );

        const skip =
            (page - 1) * limit;


        const where:
            Prisma.PurchaseOrderWhereInput = {

            ...(query.agencyId && {
                agencyId:
                    query.agencyId
            }),

            ...(query.status && {
                status:
                    query.status
            }),

            ...(query.search && {

                OR: [

                    {
                        poNo: {
                            contains:
                                query.search,

                            mode:
                                "insensitive"
                        }
                    },

                    {
                        agency: {
                            name: {
                                contains:
                                    query.search,

                                mode:
                                    "insensitive"
                            }
                        }
                    }
                ]
            })
        };


        if (
            actor.branchAccessType !== "ALL"
        ) {

            where.branchId =
                actor.branchId;

        } else if (query.branchId) {

            where.branchId =
                query.branchId;
        }


        const [data, total] =
            await Promise.all([

                prisma.purchaseOrder.findMany({

                    where,

                    include:
                        includePurchaseOrderDetails,

                    orderBy: {
                        createdAt: "desc"
                    },

                    skip,
                    take: limit
                }),

                prisma.purchaseOrder.count({
                    where
                })
            ]);


        return {

            data,

            meta: {

                page,
                limit,
                total,

                totalPages:
                    Math.ceil(
                        total / limit
                    ),

                hasNextPage:
                    page * limit < total,

                hasPreviousPage:
                    page > 1
            }
        };
    }


    /* ============================================================
    * GET PURCHASE INVOICE ENTRY DATA
    *
    * Used when user selects a PO in Purchase Invoice Entry.
    * ============================================================ */

    static async getPurchaseInvoiceEntry(
        actor: any,
        purchaseOrderId: string
    ) {

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        const po =
            await prisma.purchaseOrder.findUnique({

                where: {
                    id: purchaseOrderId
                },

                include: {

                    agency: true,

                    branch: true,

                    items: {
                        include: {
                            product: true
                        }
                    },

                    purchases: {
                        select: {
                            id: true,
                            invoiceNo: true,
                            status: true
                        }
                    }
                }
            });

        if (!po) {
            throw new ApiError(
                "Purchase order not found",
                404
            );
        }

        this.validateBranchAccess(
            actor,
            po.branchId
        );

        if (
            po.status !==
            PurchaseOrderStatus.APPROVED
        ) {
            throw new ApiError(
                "Only approved purchase orders can be used for Purchase Invoice Entry",
                400
            );
        }

        return {

            purchaseOrderId:
                po.id,

            poNo:
                po.poNo,

            poDate:
                po.poDate,

            remarks:
                po.remarks,

            agency: {
                id:
                    po.agency.id,

                name:
                    po.agency.name
            },

            branch: {
                id:
                    po.branch.id,

                name:
                    po.branch.name,

                code:
                    po.branch.code
            },

            items:
                po.items.map(item => ({

                    purchaseOrderItemId:
                        item.id,

                    productId:
                        item.productId,

                    productName:
                        item.product.name,

                    sku:
                        item.product.sku,

                    hsnNo:
                        item.product.hsnNo,

                    gstPercent:
                        Number(
                            item.product.applicableGST || 0
                        ),

                    orderedQuantity:
                        Number(item.quantity),

                    /*
                    * Default actual quantity to PO quantity.
                    * User may edit it before creating Purchase.
                    */
                    quantity:
                        Number(item.quantity),

                    unit:
                        item.unit,

                    /*
                    * Default actual price to PO price.
                    * User may edit it.
                    */
                    purchasePrice:
                        Number(item.purchasePrice),

                    /*
                    * PO doesn't know the actual batch.
                    */
                    batchNo:
                        null
                }))
        };
    }


    /* ============================================================
    * CREATE PURCHASE FROM APPROVED PURCHASE ORDER
    *
    * RULES
    * ------------------------------------------------------------
    * 1. Purchase Order must exist and be APPROVED.
    * 2. Agency and Branch always come from the PO.
    * 3. Product selection is FIXED by the PO.
    * 4. Client CANNOT add products outside the PO.
    * 5. Client CANNOT duplicate the same PO product.
    * 6. Quantity is editable.
    * 7. Purchase price is editable.
    * 8. Batch number is editable.
    * 9. Product master remains responsible for GST/HSN/etc.
    * 10. Final Purchase is created through existing
    *     PurchaseService.createPurchase().
    * ============================================================ */

    // static async createPurchaseFromOrder(
    //     actor: any,
    //     purchaseOrderId: string,
    //     payload: CreatePurchaseFromOrderPayload
    // ) {

    //     await this.ensurePermission(
    //         actor,
    //         "PURCHASE:WRITE"
    //     );

    //     /* ========================================================
    //     * BASIC VALIDATION
    //     * ======================================================== */

    //     if (!purchaseOrderId?.trim()) {
    //         throw new ApiError(
    //             "Purchase Order ID is required",
    //             400
    //         );
    //     }

    //     if (!payload.invoiceNo?.trim()) {
    //         throw new ApiError(
    //             "Supplier invoice number is required",
    //             400
    //         );
    //     }

    //     if (!payload.items?.length) {
    //         throw new ApiError(
    //             "Purchase items are required",
    //             400
    //         );
    //     }

    //     /* ========================================================
    //     * LOAD PURCHASE ORDER
    //     * ======================================================== */

    //     const po =
    //         await prisma.purchaseOrder.findUnique({

    //             where: {
    //                 id: purchaseOrderId
    //             },

    //             include: {

    //                 items: true,

    //                 purchases: {
    //                     select: {
    //                         id: true,
    //                         invoiceNo: true,
    //                         status: true
    //                     }
    //                 }
    //             }
    //         });

    //     if (!po) {
    //         throw new ApiError(
    //             "Purchase order not found",
    //             404
    //         );
    //     }

    //     /* ========================================================
    //     * BRANCH ACCESS
    //     * ======================================================== */

    //     this.validateBranchAccess(
    //         actor,
    //         po.branchId
    //     );

    //     /* ========================================================
    //     * PO MUST BE APPROVED
    //     * ======================================================== */

    //     if (
    //         po.status !==
    //         PurchaseOrderStatus.APPROVED
    //     ) {
    //         throw new ApiError(
    //             "Purchase can only be created from an approved purchase order",
    //             400
    //         );
    //     }

    //     if (!po.items.length) {
    //         throw new ApiError(
    //             `Purchase order ${po.poNo} has no items`,
    //             400
    //         );
    //     }

    //     /* ========================================================
    //     * BUILD PO PRODUCT MAP
    //     *
    //     * PO is the source of truth for product selection.
    //     * ======================================================== */

    //     const poItemMap =
    //         new Map(
    //             po.items.map(
    //                 item => [
    //                     item.productId,
    //                     item
    //                 ]
    //             )
    //         );

    //     /* ========================================================
    //     * PREVENT DUPLICATE PRODUCTS IN REQUEST
    //     * ======================================================== */

    //     const submittedProductIds =
    //         new Set<string>();

    //     for (const item of payload.items) {

    //         if (!item.productId) {
    //             throw new ApiError(
    //                 "Product ID is required for every purchase item",
    //                 400
    //             );
    //         }

    //         if (
    //             submittedProductIds.has(
    //                 item.productId
    //             )
    //         ) {
    //             throw new ApiError(
    //                 `Product ${item.productId} has been submitted more than once`,
    //                 400
    //             );
    //         }

    //         submittedProductIds.add(
    //             item.productId
    //         );
    //     }

    //     /* ========================================================
    //     * VALIDATE PRODUCTS
    //     *
    //     * No product outside the PO is allowed.
    //     * ======================================================== */

    //     for (const item of payload.items) {

    //         if (
    //             !poItemMap.has(
    //                 item.productId
    //             )
    //         ) {
    //             throw new ApiError(
    //                 `Product ${item.productId} does not belong to Purchase Order ${po.poNo}`,
    //                 400
    //             );
    //         }
    //     }

    //     /* ========================================================
    //     * REQUIRE ALL PO PRODUCTS
    //     *
    //     * This makes the PO product list FIXED.
    //     *
    //     * PO:
    //     * Product A
    //     * Product B
    //     *
    //     * Purchase must contain:
    //     * Product A
    //     * Product B
    //     *
    //     * Client cannot:
    //     * - add Product C
    //     * - remove Product A/B
    //     * - duplicate Product A/B
    //     *
    //     * Quantity / price / batch remain editable.
    //     * ======================================================== */

    //     if (
    //         submittedProductIds.size !==
    //         poItemMap.size
    //     ) {

    //         const missingProducts =
    //             po.items
    //                 .filter(
    //                     poItem =>
    //                         !submittedProductIds.has(
    //                             poItem.productId
    //                         )
    //                 )
    //                 .map(
    //                     poItem =>
    //                         poItem.productId
    //                 );

    //         throw new ApiError(
    //             `Purchase must contain all products from Purchase Order ${po.poNo}. Missing products: ${missingProducts.join(", ")}`,
    //             400
    //         );
    //     }

    //     /* ========================================================
    //     * BUILD FINAL PURCHASE ITEMS
    //     *
    //     * IMPORTANT:
    //     *
    //     * productId -> PO
    //     *
    //     * quantity -> CLIENT / actual invoice
    //     * price    -> CLIENT / actual invoice
    //     * batchNo  -> CLIENT / actual received batch
    //     *
    //     * We DO NOT blindly forward payload.items.
    //     * ======================================================== */

    //     const purchaseItems =
    //         payload.items.map(
    //             item => {

    //                 const poItem =
    //                     poItemMap.get(
    //                         item.productId
    //                     );

    //                 if (!poItem) {
    //                     // Defensive check.
    //                     // Should already be impossible because of
    //                     // validation above.
    //                     throw new ApiError(
    //                         `Product ${item.productId} does not belong to Purchase Order ${po.poNo}`,
    //                         400
    //                     );
    //                 }

    //                 const quantity =
    //                     Number(item.quantity);

    //                 const purchasePrice =
    //                     Number(item.purchasePrice);

    //                 const batchNo =
    //                     item.batchNo?.trim();

    //                 /* --------------------------------------------
    //                 * ACTUAL QUANTITY
    //                 * -------------------------------------------- */

    //                 if (
    //                     !Number.isFinite(quantity) ||
    //                     quantity <= 0
    //                 ) {
    //                     throw new ApiError(
    //                         `Quantity must be greater than zero for product ${item.productId}`,
    //                         400
    //                     );
    //                 }

    //                 /* --------------------------------------------
    //                 * ACTUAL PURCHASE PRICE
    //                 * -------------------------------------------- */

    //                 if (
    //                     !Number.isFinite(purchasePrice) ||
    //                     purchasePrice < 0
    //                 ) {
    //                     throw new ApiError(
    //                         `Invalid purchase price for product ${item.productId}`,
    //                         400
    //                     );
    //                 }

    //                 /* --------------------------------------------
    //                 * ACTUAL BATCH
    //                 * -------------------------------------------- */

    //                 if (!batchNo) {
    //                     throw new ApiError(
    //                         `Batch number is required for product ${item.productId}`,
    //                         400
    //                     );
    //                 }

    //                 return {

    //                     /*
    //                     * PRODUCT IS FIXED FROM PO.
    //                     */
    //                     productId:
    //                         poItem.productId,

    //                     /*
    //                     * These are actual invoice /
    //                     * received values and may differ
    //                     * from PO.
    //                     */
    //                     quantity,

    //                     purchasePrice,

    //                     batchNo,

    //                     /*
    //                     * Unit should also come from PO
    //                     * rather than trusting client input.
    //                     */
    //                     unit:
    //                         poItem.unit
    //                 };
    //             }
    //         );


    //     return PurchaseService.createPurchase(
    //         actor,
    //         {

    //             /* ------------------------------------------------
    //             * PO RELATION
    //             * ------------------------------------------------ */

    //             purchaseOrderId:
    //                 po.id,

    //             /* ------------------------------------------------
    //             * FIXED FROM PO
    //             * ------------------------------------------------ */

    //             agencyId:
    //                 po.agencyId,

    //             branchId:
    //                 po.branchId,

    //             /* ------------------------------------------------
    //             * ACTUAL SUPPLIER INVOICE
    //             * ------------------------------------------------ */

    //             invoiceNo:
    //                 payload.invoiceNo.trim(),

    //             invoiceDate:
    //                 payload.invoiceDate,

    //             supplierInvoiceDate:
    //                 payload.supplierInvoiceDate,

    //             otherReference:
    //                 payload.otherReference,

    //             remarks:
    //                 payload.remarks,

    //             roundOffAmount:
    //                 payload.roundOffAmount,

    //             /* ------------------------------------------------
    //             * TRANSPORT
    //             * ------------------------------------------------ */

    //             transport: {

    //                 /*
    //                 * PO identity is controlled
    //                 * by server.
    //                 */
    //                 purchaseOrderNo:
    //                     po.poNo,

    //                 purchaseOrderDate:
    //                     po.poDate,

    //                 /*
    //                 * Actual transport details
    //                 * supplied during invoice entry.
    //                 */
    //                 ...payload.transport
    //             },

    //             /* ------------------------------------------------
    //             * ACTUAL PURCHASE ITEMS
    //             * ------------------------------------------------ */

    //             items:
    //                 purchaseItems
    //         }
    //     );
    // }

    /* ============================================================
    * GET PURCHASE ORDER PDF DATA
    * ============================================================ */

    private static async getPurchaseOrderPdfData(
        purchaseOrderId: string,
    ) {

        

        const po =
            await prisma.purchaseOrder.findUnique({

                where: {
                    id: purchaseOrderId
                },

                include: {

                    agency: true,

                    branch: true,

                    createdBy: {
                        select: {
                            id: true,
                            name: true
                        }
                    },

                    approvedBy: {
                        select: {
                            id: true,
                            name: true
                        }
                    },

                    items: {

                        include: {
                            product: true
                        },

                        orderBy: {
                            createdAt: "asc"
                        }
                    }
                }
            });


        if (!po) {

            throw new ApiError(
                "Purchase order not found",
                404
            );
        }


        if (
            po.status !==
            PurchaseOrderStatus.APPROVED
        ) {

            throw new ApiError(
                "PDF can only be generated for an approved Purchase Order",
                400
            );
        }


        const setting =
            await prisma.setting.findFirst();


        return {

            company: {

                /*
                * Change this to your actual
                * company name if stored elsewhere.
                */
                name:
                    "AG ASHTAVINAYAKA PVT LTD",

                logo:
                    setting?.sellerLogo ||
                    null,

                signature:
                    setting?.signatureImage ||
                    null,

                /*
                * Branch is being used as the
                * issuing company location.
                */

                addressLine1:
                    po.branch.addressLine1,

                addressLine2:
                    po.branch.addressLine2,

                city:
                    po.branch.city,

                state:
                    po.branch.state,

                pinCode:
                    po.branch.pinCode,

                phone:
                    po.branch.phnNumber,

                email:
                    po.branch.email,

                gstin:
                    po.branch.gstin
            },


            branch: {

                id:
                    po.branch.id,

                name:
                    po.branch.name,

                code:
                    po.branch.code,

                addressLine1:
                    po.branch.addressLine1,

                addressLine2:
                    po.branch.addressLine2,

                city:
                    po.branch.city,

                state:
                    po.branch.state,

                pinCode:
                    po.branch.pinCode,

                phone:
                    po.branch.phnNumber,

                email:
                    po.branch.email,

                gstin:
                    po.branch.gstin
            },


            vendor: {

                id:
                    po.agency.id,

                name:
                    po.agency.name,

                contactPerson:
                    po.agency.contactPerson,

                addressLine1:
                    po.agency.addressLine1,

                addressLine2:
                    po.agency.addressLine2,

                city:
                    po.agency.city,

                state:
                    po.agency.state,

                pinCode:
                    po.agency.pinCode,

                mobileNumber:
                    po.agency.mobileNumber,

                email:
                    po.agency.email,

                gstin:
                    po.agency.gstin
            },


            po: {
                id: po.id,

                poNo: po.poNo,

                poDate: formatISTDateOnly(
                    po.poDate
                ),

                status: po.status,

                remarks:
                    po.remarks,

                subtotalAmount:
                    this.formatMoney(
                        po.subtotalAmount
                    ),

                // Company issuing the requisition
                requisitioner:
                    "ASHTAVINAYAKA",

                createdBy:
                    po.createdBy?.name ||
                    "-",

                approvedBy:
                    po.approvedBy?.name ||
                    "-",

                approvedAt:
                    formatISTDateOnly(
                        po.approvedAt
                    )
            },


            items:
                po.items.map(
                    (item, index) => ({

                        slNo: index + 1,

                        id: item.id,
                        productId: item.productId,
                        sku: item.product.sku,

                        // ITEM
                        name:
                            item.product.name,

                        // PARTICULARS
                        description:
                            item.product.description?.trim() ||
                            null,

                        disclaimer:
                            item.product.disclaimer?.trim() ||
                            null,

                        quantity:
                            Number(
                                item.quantity
                            ).toLocaleString(
                                "en-IN",
                                {
                                    maximumFractionDigits: 3
                                }
                            ),

                        unit:
                            item.unit,

                        purchasePrice:
                            this.formatMoney(
                                item.purchasePrice
                            ),

                        totalAmount:
                            this.formatMoney(
                                item.totalAmount
                            )
                    })
                )
        };
    }

    /* ============================================================
    * GENERATE PURCHASE ORDER PDF
    * ============================================================ */

    static async generatePurchaseOrderPdf(
        actor: any,
        purchaseOrderId: string
    ) {

        await this.ensurePermission(
            actor,
            "PURCHASE:VIEW"
        );

        if (!actor?.id) {

            throw new ApiError(
                "Unauthorized",
                401
            );
        }


        const po =
            await prisma.purchaseOrder.findUnique({

                where: {
                    id: purchaseOrderId
                },

                select: {
                    id: true,
                    branchId: true,
                    status: true
                }
            });


        if (!po) {

            throw new ApiError(
                "Purchase order not found",
                404
            );
        }


        this.validateBranchAccess(
            actor,
            po.branchId
        );


        if (
            po.status !==
            PurchaseOrderStatus.APPROVED
        ) {

            throw new ApiError(
                "PDF is available only after Purchase Order approval",
                400
            );
        }


        const data =
            await this.getPurchaseOrderPdfData(
                purchaseOrderId
            );


        const pdf =
            await PurchaseOrderRenderer
                .generatePdf(data);


        return {

            pdf,

            poNo:
                data.po.poNo
        };
    }
}