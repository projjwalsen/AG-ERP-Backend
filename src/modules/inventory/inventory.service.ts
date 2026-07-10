import { Prisma, ProductUnit } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";

type AddStockPayload = {
    branchId: string;
    productId: string;

    batchNo: string;

    quantity: number;
    unit: ProductUnit;

    purchasePrice: number;
    transactionDate?:Date;
};

type RemoveStockPayload = {
    branchId: string;
    productId: string;

    batchId: string;

    quantity: number;
    unit: ProductUnit;
    transactionDate?:Date;
};

export class InventoryService {

    static async addStock(
        tx: Prisma.TransactionClient | typeof prisma, 
        payload: AddStockPayload
    ) {
        if(
            !payload.branchId ||
            !payload.productId ||
            !payload.batchNo
        ) {
            throw new ApiError("Branch ID, Product ID and Batch No are required", 400);
        }

        if(payload.quantity <= 0) {
            throw new ApiError("Quantity must be greater than 0", 400);
        }

        // Implementation for adding stock
        const product = await tx.product.findUnique({
            where: {
                id: payload.productId
            }
        });

        if(!product) {
            throw new ApiError("Product not found", 404);
        }

        /** Find existing Batch */
        let inventoryBatch = 
            await tx.inventoryBatch.findUnique({
                where: {
                    branchId_productId_batchNo: {
                        branchId: payload.branchId,
                        productId: payload.productId,
                        batchNo: payload.batchNo
                    }
                }
            });

            // Quantity conversion
            let quantityKG = 0;
            let quantityLTR = 0;

            const density = Number(product.density ?? 1);

            if (payload.unit === ProductUnit.KG) {

                quantityKG = payload.quantity;

                quantityLTR = Number(
                    (payload.quantity / density).toFixed(3)
                );

            } else {

                // Excel quantity remains LTR
                quantityLTR = payload.quantity;

                // Default density = 1 when missing
                quantityKG = Number(
                    (payload.quantity * density).toFixed(3)
                );

            }

        /** Create / Update Batch */
        if (!inventoryBatch) {

            inventoryBatch = await tx.inventoryBatch.create({
                data: {
                    branchId: payload.branchId,
                    productId: payload.productId,
                    batchNo: payload.batchNo,
                    purchasePrice: payload.purchasePrice,

                    availableQtyKG: quantityKG,
                    availableQtyLTR: quantityLTR,
                    createdAt: payload.transactionDate ?? new Date(),

                    isActive: true
                }
            });

        } else {

            inventoryBatch = await tx.inventoryBatch.update({
                where: {
                    id: inventoryBatch.id
                },
                data: {
                    availableQtyKG: {
                        increment: quantityKG
                    },
                    availableQtyLTR: {
                        increment: quantityLTR
                    },
                    purchasePrice: payload.purchasePrice,
                    isActive: true
                }
            });

        }

        /** Safety check */
        if (!inventoryBatch) {
            throw new ApiError(
                `Failed to create inventory batch for Product ${payload.productId}`,
                500
            );
        }

        /** Update Inventory Summary */
        await this.updateInventorySummary(tx, {
            branchId: payload.branchId,
            productId: payload.productId,
            quantityKG,
            quantityLTR,
            operation: "ADD"
        });

        return inventoryBatch;
    }

    static async removeStock(
        tx : Prisma.TransactionClient | typeof prisma,
        payload: RemoveStockPayload
    ) {
        if(
            !payload.branchId ||
            !payload.productId ||
            !payload.batchId
        ) {
            throw new ApiError("Branch ID, Product ID and Batch ID are required", 400);
        }
        if(payload.quantity <= 0) {
            throw new ApiError("Quantity must be greater than 0", 400);
        }
        const product = await tx.product.findUnique({
            where: {
                id: payload.productId
            }
        });
        if(!product) {
            throw new ApiError("Product not found", 404);
        }

        /** Find batch */
        const inventoryBatch = 
            await tx.inventoryBatch.findUnique({
                where: {
                    id: payload.batchId
                }
            });

        if(!inventoryBatch) {
            throw new ApiError("Inventory Batch not found", 404);
        }

        // Quantity conversion
        let quantityKG = 0;
        let quantityLTR = 0;

        const settings = await tx.setting.findFirst();

        const allowNegativeStock =
            settings?.allowNegativeInventory ?? false;

        const density =
            Number(product.density ?? 1);

        if (payload.unit === ProductUnit.KG) {

            quantityKG = payload.quantity;

            quantityLTR = Number(
                (payload.quantity / density).toFixed(3)
            );

            if (
                !allowNegativeStock &&
                Number(inventoryBatch.availableQtyKG) < quantityKG
            ) {
                throw new ApiError(
                    "Insufficient stock in KG. Allow negativeInventory in settings.",
                    400
                );
            }

        } else {

            // Sale quantity remains in LTR
            quantityLTR = payload.quantity;

            // Default density = 1
            quantityKG = Number(
                (payload.quantity * density).toFixed(3)
            );

            if (
                !allowNegativeStock &&
                Number(inventoryBatch.availableQtyLTR) < quantityLTR
            ) {
                throw new ApiError(
                    "Insufficient stock in LTR. Allow negativeInventory in settings.",
                    400
                );
            }

        }

        /** Update Batch */
        if(allowNegativeStock) {
            await tx.inventoryBatch.update({
                where: {
                    id: inventoryBatch.id
                },
                data: {
                    availableQtyKG: {
                        decrement: quantityKG
                    },
                    availableQtyLTR: {
                        decrement: quantityLTR
                    }
                }
            })
        } else {
            const updatedResult = await tx.inventoryBatch.updateMany({
                where: {
                    id: inventoryBatch.id,
                    ...(payload.unit === ProductUnit.KG
                        ? {
                            availableQtyKG: {
                                gte: quantityKG
                            }
                        }
                        : {
                            availableQtyLTR: {
                                gte: quantityLTR
                            }
                        })
                },
                data: {
                    availableQtyKG: {
                        decrement: quantityKG
                    },
                    availableQtyLTR: {
                        decrement: quantityLTR
                    }
                }
            });
    
            if(updatedResult.count === 0) {
                throw new ApiError("Stock may have been modified by another transaction. Please try again.", 409);
            }
        }

        const updatedBatch = await tx.inventoryBatch.findUnique({
            where: {
                id: inventoryBatch.id
            }
        });
        if(!updatedBatch) {
            throw new ApiError("Inventory Batch not found after update", 404);
        }

        /** Deactivate batch if stock is depleted */
        if(
            Number(updatedBatch.availableQtyKG) <= 0 &&
            Number(updatedBatch.availableQtyLTR) <= 0
        ) {
            await tx.inventoryBatch.update({
                where: {
                    id: inventoryBatch.id
                },
                data: {
                    isActive: false
                }
            })
        }

        /** Update inventory Summary */
        await this.updateInventorySummary(tx, {
            branchId: payload.branchId,
            productId: payload.productId,
            quantityKG: quantityKG,
            quantityLTR: quantityLTR,
            operation: "REMOVE"
        });

        return updatedBatch;
    }

    static async updateInventorySummary(
        tx: Prisma.TransactionClient | typeof prisma,
        payload: {
            branchId: string;
            productId: string;
            quantityKG: number;
            quantityLTR: number;
            operation: "ADD" | "REMOVE";
        }
    ) {

        const settings = await tx.setting.findFirst();

        const allowNegativeStock =
            settings?.allowNegativeInventory ?? false;

        let inventory =
            await tx.inventory.findUnique({
                where: {
                    branchId_productId: {
                        branchId: payload.branchId,
                        productId: payload.productId
                    }
                }
            });

        /**
         * First stock for this product
         */
        if (!inventory) {

            try {

                inventory = await tx.inventory.create({

                    data: {

                        branchId: payload.branchId,

                        productId: payload.productId,

                        currentStockKG:
                            payload.operation === "ADD"
                                ? payload.quantityKG
                                : -payload.quantityKG,

                        currentStockLTR:
                            payload.operation === "ADD"
                                ? payload.quantityLTR
                                : -payload.quantityLTR

                    }

                });

                return inventory;

            } catch (err: any) {

                if (
                    err.code === "P2002"
                ) {

                    inventory =
                        await tx.inventory.findUnique({

                            where: {

                                branchId_productId: {

                                    branchId: payload.branchId,

                                    productId: payload.productId

                                }

                            }

                        });

                } else {

                    throw err;

                }

            }

        }

        /**
         * REMOVE
         */
        if (payload.operation === "REMOVE") {

            if (allowNegativeStock) {

                return await tx.inventory.update({

                    where: {
                        id: inventory.id
                    },

                    data: {

                        currentStockKG: {
                            decrement: payload.quantityKG
                        },

                        currentStockLTR: {
                            decrement: payload.quantityLTR
                        }

                    }

                });

            }

            const updated =
                await tx.inventory.updateMany({

                    where: {

                        id: inventory.id,

                        ...(payload.quantityKG > 0 && {
                            currentStockKG: {
                                gte: payload.quantityKG
                            }
                        }),

                        ...(payload.quantityLTR > 0 && {
                            currentStockLTR: {
                                gte: payload.quantityLTR
                            }
                        })

                    },

                    data: {

                        currentStockKG: {
                            decrement: payload.quantityKG
                        },

                        currentStockLTR: {
                            decrement: payload.quantityLTR
                        }

                    }

                });

            if (!updated.count) {

                throw new ApiError(
                    "Stock may have been modified by another transaction | NegativeInventory not allowed in settings",
                    409
                );

            }

            return;
        }

        /**
         * ADD
         */
        return await tx.inventory.update({

            where: {
                id: inventory.id
            },

            data: {

                currentStockKG: {
                    increment: payload.quantityKG
                },

                currentStockLTR: {
                    increment: payload.quantityLTR
                }

            }

        });

    }

    /**
     * =========================================
     * GET AVAILABLE BATCHES
     * =========================================
     * Used during:
     * - Sales dropdown
     * - Batch history
     *
     * Behavior:
     * - isActive=true  -> only active batches
     * - isActive=false -> only inactive batches
     * - isActive undefined -> all batches
     */
    static async getAvailableBatches(
        actor: any,
        branchId?: string,
        productId?: string,
        isActive?: boolean,

    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const where = {
            ...(branchId && {
                branchId: branchId
            }),

            ...(productId && {
                productId:productId
            }),

            ...(isActive !== undefined && {
                isActive: isActive
            }),
        }

        return prisma.inventoryBatch.findMany({
            where,
            select: {
                id: true,
                batchNo: true,
                purchasePrice: true,
                availableQtyKG: true,
                availableQtyLTR: true,
                isActive: true,
                createdAt: true,
                lastUpdated: true,
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                product: {
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                        baseUnit: true,
                        minimumStockKG: true,
                        density: true
                    }
                }
            },
            orderBy: {
                createdAt: "asc"
            }
        })
    }

    /**
     * =========================================
     * ------ Operational Views & Alerts ------
     * Inventory table page
     * Batch stock screen
     * Show live stock monitoring
     * Also show low stock alerts
     * =========================================
     */

    static async getAllInventoryBatches(
        actor: any,
        query?: {
            page?: number;
            limit?: number;
            branchId?: string;
            productId?: string;
            search?: string;
            isActive?: boolean;
            export?: boolean;
        }
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 20;
        const skip = (page - 1) * limit;

        const where = {
            ...(
                query?.branchId && { branchId: query.branchId }
            ),
            ...(
                query?.productId && { productId: query.productId }
            ),
            ...(
                query?.isActive !== undefined && { isActive: query.isActive }
            ),
            ...(
                query?.search && {
                    OR: [
                        {
                            batchNo: {
                                contains: query.search,
                                mode: "insensitive" as const
                            }
                        },
                        {
                            product: {
                                name: {
                                    contains: query.search,
                                    mode: "insensitive" as const
                                }
                            }
                        },
                        {
                            product: {
                                sku: {
                                    contains: query.search,
                                    mode: "insensitive" as const
                                }
                            }
                        }
                    ]
                }
            )
        };

        const [batches, total] = await Promise.all([
            prisma.inventoryBatch.findMany({
                where,
                include: {
                    product: true,
                    branch: true
                },
                orderBy: {
                    createdAt: "desc"
                },
                ...(query?.export
                    ? {}
                    : {
                        skip,
                        take: limit
                })
            }),
            prisma.inventoryBatch.count({ where })
        ]);

        const formattedBatches = batches.map((batch) => {
            let status = "IN_STOCK";
            if(!batch.isActive){
                status = "OUT_OF_STOCK";
            }
            else if (
                batch.product.minimumStockKG &&
                Number(batch.availableQtyKG) < Number(batch.product.minimumStockKG)
            ) {
                status = "LOW_STOCK";
            }

            return {
                ...batch,
                status
            }
        });

        return {
            data: formattedBatches,
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

    static async getBranchInventorySummary(
        actor: any,
        query?: {
            page?: number;
            limit?: number;
            productId?: string;
            search?: string;
            export?: boolean;
        } 
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 20;
        const skip = (page - 1) * limit;

        const productWhere: any = {
            ...(query?.productId && {
                id: query.productId
            }),

            ...(query?.search && {
                OR: [
                    {
                        name: {
                            contains: query.search,
                            mode: "insensitive"
                        }
                    },
                    {
                        sku: {
                            contains: query.search,
                            mode: "insensitive"
                        }
                    }
                ]
            })
        };


        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where: productWhere,
                skip,
                take: limit,
                orderBy: {
                    createdAt: "desc"
                },
                ...(query?.export
                        ? {}
                        : {
                            skip,
                            take: limit
                    }),
            }),
            prisma.product.count({
                where: productWhere
            })
        ]);

        const data = await Promise.all(
            products.map(async (product) => {

                const inventories =
                    await prisma.inventory.findMany({
                        where: {
                            productId: product.id
                        }
                    });

                const totalStockKG = inventories.reduce(
                    (sum, inv) =>
                        sum + Number(inv.currentStockKG || 0),
                    0
                );

                const totalStockLTR = inventories.reduce(
                    (sum, inv) =>
                        sum + Number(inv.currentStockLTR || 0),
                    0
                );

                let status = "IN_STOCK";

                if (totalStockKG === 0) {
                    status = "OUT_OF_STOCK";
                } else if (
                    product.minimumStockKG &&
                    totalStockKG < Number(product.minimumStockKG)
                ) {
                    status = "LOW_STOCK";
                }

                return {
                    productId: product.id,
                    name: product.name,
                    sku: product.sku,
                    baseUnit: product.baseUnit,
                    density: product.density,

                    totalStockKG,
                    totalStockLTR,

                    minimumStockKG:
                        product.minimumStockKG,

                    branchCount:
                        inventories.length,

                    status
                };
            })
        );
        return {
            data,
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

    static async getProductBatchHistory(
        actor: any,
        productId: string,
    ){
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(!productId){
            throw new ApiError("Product ID is required", 400);
        }

        const product = await prisma.product.findUnique({
            where: {
                id: productId
            }
        });

        if(!product) {
            throw new ApiError("Product not found", 404);
        }

        const batches = await prisma.inventoryBatch.findMany({
            where: {
                productId
            },
            include: {
                branch: true,
            },
            orderBy:{
                createdAt: "desc"
            }
        });

        const branchMap = new Map();

        for(const batch of batches){

            if(!branchMap.has(batch.branchId)){
                branchMap.set(batch.branchId, {
                    branchId: batch.branchId,
                    branchName: batch.branch.name,
                    branchCode: batch.branch.code,
                    stateCode: batch.branch.stateCode,
                    city: batch.branch.city,
                    state: batch.branch.state,
                    addressLine1: batch.branch.addressLine1,
                    addressLine2: batch.branch.addressLine2,
                    batches: []
                })
            }

            branchMap.get(batch.branchId).batches.push({
                id: batch.id,
                batchNo: batch.batchNo,
                purchasePrice: batch.purchasePrice,
                availableQtyKG: batch.availableQtyKG,
                availableQtyLTR: batch.availableQtyLTR,
                isActive: batch.isActive,
                createdAt: batch.createdAt,
                lastUpdated: batch.lastUpdated
            });
        }

        return {
            product: {
                id: product.id,
                name: product.name,
                sku: product.sku,
                baseUnit: product.baseUnit,
                density: product.density,
                hsnNo: product.hsnNo,
                sellPricePerUnit: product.sellPricePerUnit,
                minimumStockKG: product.minimumStockKG
            },
            branches: Array.from(branchMap.values())
        }
    }
}