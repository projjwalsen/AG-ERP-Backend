import { ProductType, ProductUnit } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { convertKGToLTR } from "../../core/utils/density.utils";
import { ProductLedgerService } from "../accounting/productLedger/productLedger.service";
import { ManufacturingService } from "../manufacturing/manufacturing.service";

type CreateProductPayload = {
    sku: string;
    name: string;
    category: string;
    productType?: ProductType;
    description?: string;
    disclaimer?: string;

    hsnNo?: string;
    applicableGST?: number;
    baseUnit: ProductUnit;
    density?: number;

    operationalUnit: ProductUnit;
    minimumStockKG?: number;
    openingStockKG?: number;

    sellPricePerUnit: number;
    recipe?: {
        outputQuantity: number;
        outputUnit: ProductUnit;
        items: { productId: string; quantity: number; unit: ProductUnit }[];
        remarks?: string;
    };
}

type UpdateProductPayload = Partial<CreateProductPayload>;

const HSN_REGEX = /^(\d{4}|\d{6}|\d{8})$/;

export class ProductService {

    static async createProduct(
        actor: any,
        payload: CreateProductPayload
    ) {
        if(!actor?.id){
            throw new ApiError(
                "Unauthorized",
                401
            )
        }
        if(!payload.sku || !payload.name || !payload.category || !payload.baseUnit){
            throw new ApiError(
                "Missing required fields: sku, name, category, baseUnit",
                400
            )
        }
        const normalizedPrice = Number(payload.sellPricePerUnit);
        let sellPriceLTR: number | null = null;

        if (
            payload.density &&
            (payload.baseUnit === ProductUnit.KG || payload.baseUnit === ProductUnit.MT)
        ) {
            const pricePerKG =
                payload.baseUnit === ProductUnit.MT
                    ? normalizedPrice / 1000
                    : normalizedPrice;

            sellPriceLTR =
                Number(
                    (
                        pricePerKG *
                        payload.density
                    ).toFixed(2)
                );
        }
        const normalizedSKU = payload.sku.trim().toUpperCase();

        const existingProduct = await prisma.product.findUnique({
            where: { sku: normalizedSKU }
        });

        if(existingProduct){
            throw new ApiError(
                "Product with the same SKU already exists",
                400
            )
        }

        if(payload.density !== undefined && payload.density <= 0){
            throw new ApiError(
                "Density must be greater than 0",
                400
            )
        }

        /**
         * If operational unit is LTR
         * density becomes mandatory
         */
        if (
            ((payload.baseUnit || ProductUnit.KG) === ProductUnit.KG ||
                (payload.baseUnit || ProductUnit.KG) === ProductUnit.MT) &&
            (payload.operationalUnit || "LTR") === "LTR" &&
            !payload.density
        ) {
            throw new ApiError(
                "Density is required for KG to LTR conversion products",
                400
            );
        }

        if (payload.hsnNo && !HSN_REGEX.test(payload.hsnNo)) {
            throw new ApiError(
                "HSN number must be 4, 6, or 8 digits",
                400
            );
        }
        /**
         * Delta --> Preview LTR
         */
        const previewLTR = payload.density ? convertKGToLTR(1000, payload.density) : null;

        const productType = payload.productType || ProductType.PURCHASED;
        const shouldCreateRecipe = productType === ProductType.MANUFACTURED || productType === ProductType.BOTH;

        if (shouldCreateRecipe && !payload.recipe) {
            throw new ApiError(
                "Recipe payload is required for manufactured products",
                400
            );
        }

        const { product, recipe } = await prisma.$transaction(async tx => {
            const product = await tx.product.create({
                data: {
                    sku: normalizedSKU,
                    name: payload.name.trim(),
                    category: payload.category.trim(),
                    productType,
                    description: payload.description?.trim() || null,
                    disclaimer: payload.disclaimer?.trim() || null,
                    hsnNo: payload.hsnNo,
                    applicableGST: payload.applicableGST,
                    baseUnit: payload.baseUnit || "KG",
                    density: payload.density,
                    operationalUnit: payload.operationalUnit || "LTR",
                    minimumStockKG: payload.minimumStockKG,
                    openingStockKG: payload.openingStockKG || 0,
                    sellPricePerUnit: normalizedPrice,
                    sellPriceLTR: sellPriceLTR,
                    isActive: true
                },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    category: true,
                    productType: true,
                    description: true,
                    disclaimer: true,
                    baseUnit: true,
                    density: true,
                    hsnNo: true,
                    applicableGST: true,
                    operationalUnit: true,
                    minimumStockKG: true,
                    openingStockKG: true,
                    sellPricePerUnit: true,
                    sellPriceLTR: true,
                    isActive: true,
                    createdAt: true,
                }
            });

            await ProductLedgerService.getOrCreateProductLedger(
                product.id,
                tx
            );

            const recipe = shouldCreateRecipe && payload.recipe
                ? await ManufacturingService.createRecipeForProduct(actor, product.id, payload.recipe, tx, { autoApprove: true })
                : null;

            return { product, recipe };
        });

        return {
            ...product,
            recipe,
            conversionPreview: payload.density ? {
                sampleKg: 1000,
                equivalentLtr: previewLTR!,
            } : null
        }
    }

    static async getAllProducts(
        actor: any,
        query?: {
            search?: string;
            productName?: string;
            category?: string;
            page?: number;
            limit?: number;
            export?: boolean;
        }
    ) {
        if(!actor?.id){
            throw new ApiError(
                "Unauthorized",
                401
            )
        }

        const search = query?.search?.trim();
        const productName = query?.productName?.trim();
        const category = query?.category?.trim();
        const page     = query?.page  || 1;
        const limit    = query?.limit || 10;
        const skip     = (page - 1) * limit;

        const where = {
            ...(category && {
                category: { contains: category, mode: "insensitive" as const }
            }),
            ...(productName && {
                name: { contains: productName, mode: "insensitive" as const }
            }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { sku:  { contains: search, mode: "insensitive" as const } },
                ]
            })
        };

        const total = await prisma.product.count({
            where,
        });

        const products =
            await prisma.product.findMany({
                where,

                select: {
                    id: true,
                    sku: true,
                    name: true,
                    category: true,
                    productType: true,
                    description: true,
                    disclaimer: true,
                    baseUnit: true,
                    density: true,
                    hsnNo: true,
                    applicableGST: true,
                    operationalUnit: true,
                    minimumStockKG: true,
                    openingStockKG: true,
                    sellPricePerUnit: true,
                    isActive: true,
                    createdAt: true,
                    recipeOutputs: {
                        include: {
                            items: {
                                include: {
                                    product: {
                                        select: {
                                            id: true,
                                            name: true,
                                            sku: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                },

                orderBy: {
                    createdAt: "desc",
                },

                ...(query?.export
                    ? {}
                    : {
                        skip: (page - 1) * limit,
                        take: limit,
                    }),
            });

        return {
            data: products,

            meta: {
                total,

                page: query?.export ? 1 : page,

                limit: query?.export
                    ? total
                    : limit,

                totalPages: query?.export
                    ? 1
                    : Math.ceil(total / limit),

                hasNextPage: query?.export
                    ? false
                    : page < Math.ceil(total / limit),

                hasPrevPage: query?.export
                    ? false
                    : page > 1,
            },
        };
    }

    static async getProductById(
        actor: any,
        productId: string
    ){
        if(!actor?.id){
            throw new ApiError(
                "Unauthorized",
                401
            )
        }

        const product = await prisma.product.findUnique({
            where: {
                id: productId
            },
            select: {
                id: true,
                sku: true,
                name: true,
                category: true,
                productType: true,
                description: true,
                disclaimer: true,
                baseUnit: true,
                density: true,
                hsnNo: true,
                applicableGST: true,
                operationalUnit: true,
                minimumStockKG: true,
                sellPricePerUnit: true,
                isActive: true,                
                createdAt: true,
                updatedAt: true,
                recipeOutputs: true
            }
        });

        if(!product){
            throw new ApiError(
                "Product not found",
                404
            )
        }

        const sampleKg = 
        Number(product.minimumStockKG) || 1000;

        const equivalentLtr =
        product.density ? convertKGToLTR(sampleKg, Number(product.density)) : null;

        return {
            ...product,
            conversionPreview: product.density ? {
                formula: "LTR = KG / Density",
                density: Number(product.density),
                sampleKg,
                equivalentLtr: equivalentLtr!,
            } : null
        }
    }

    static async updateProduct(
        actor: any,
        productId: string,
        payload: UpdateProductPayload
    ){
        if(!actor?.id){
            throw new ApiError(
                "Unauthorized",
                401
            )
        }

        const existingProduct = await prisma.product.findUnique({
            where: { id: productId }
        });

        if(!existingProduct){
            throw new ApiError(
                "Product not found",
                404
            )
        }

        const normalizedSKU = payload.sku?.trim().toUpperCase();
        const normalizedPrice = payload.sellPricePerUnit !== undefined ? Number(payload.sellPricePerUnit) : undefined;
        if(normalizedSKU && normalizedSKU !== existingProduct.sku){
            const existingProductWithSKU = await prisma.product.findUnique({
                where: { sku: normalizedSKU }
            });

            if(existingProductWithSKU){
                throw new ApiError(
                    "Product with this SKU already exists",
                    400
                )
            }
        }

        if (
            payload.density !== undefined &&
            payload.density <= 0
        ) {
            throw new ApiError(
                "Density must be greater than 0",
                400
            );
        }
        const baseUnit =
        payload.baseUnit ||
        existingProduct.baseUnit;

        const operationalUnit =
            payload.operationalUnit ||
            existingProduct.operationalUnit;

        const density =
            payload.density ??
            Number(existingProduct.density);
        if (
            (baseUnit === ProductUnit.KG || baseUnit === ProductUnit.MT) &&
            operationalUnit === ProductUnit.LTR &&
            !density
        ) {
            throw new ApiError(
                "Density is required for KG to LTR conversion products",
                400
            );
        }

        if (payload.hsnNo && !HSN_REGEX.test(payload.hsnNo)) {
            throw new ApiError(
                "HSN number must be 4, 6, or 8 digits",
                400
            );
        }

        const finalSellPrice =
            normalizedPrice ??
            Number(existingProduct.sellPricePerUnit);

        const finalDensity =
            density ??
            Number(existingProduct.density);

        let sellPriceLTR: number | null = null;

        if (
            finalDensity &&
            (baseUnit === ProductUnit.KG || baseUnit === ProductUnit.MT)
        ) {
            const pricePerKG =
                baseUnit === ProductUnit.MT
                    ? finalSellPrice / 1000
                    : finalSellPrice;

            sellPriceLTR =
                Number(
                    (
                        pricePerKG *
                        finalDensity
                    ).toFixed(2)
                );
        }

        const updatedProduct = await prisma.product.update({
            where: { id: productId },
            data: {
                sku: normalizedSKU,
                name: payload.name?.trim(),
                category: payload.category?.trim(),
                productType: payload.productType,
                description: payload.description?.trim() || null,
                disclaimer: payload.disclaimer?.trim() || null,
                baseUnit: payload.baseUnit,
                density: density,
                hsnNo: payload.hsnNo,
                applicableGST: payload.applicableGST,
                operationalUnit: operationalUnit,
                minimumStockKG: payload.minimumStockKG,
                sellPricePerUnit: finalSellPrice,
                sellPriceLTR: sellPriceLTR,
            },
            select: {
                id: true,
                sku: true,
                name: true,
                category: true,
                productType: true,
                description: true,
                disclaimer: true,
                baseUnit: true,
                density: true,
                hsnNo: true,
                applicableGST: true,
                operationalUnit: true,
                minimumStockKG: true,
                sellPricePerUnit: true,
                sellPriceLTR: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        const sampleKg =
        Number(updatedProduct.minimumStockKG) || 1000;

        const equivalentLtr =
            updatedProduct.density
                ? convertKGToLTR(
                    sampleKg,
                    Number(updatedProduct.density)
                )
            : null;

        return {
            ...updatedProduct,
            conversionPreview: updatedProduct.density ? {
                formula: "LTR = KG / Density",
                density: Number(updatedProduct.density),
                sampleKg,
                equivalentLtr: equivalentLtr!,
            } : null
        }

    }

    static async toggleProductStatus(
        actor: any,
        productId: string,
        payload: {
            isActive: boolean;
        }
    ) {
        if(!actor?.id){
            throw new ApiError(
                "Unauthorized",
                401
            )
        }

        if(typeof payload.isActive !== "boolean"){
            throw new ApiError(
                "isActive must be a boolean",
                400
            )
        }
        const existingProduct = await prisma.product.findUnique({
            where: { id: productId }
        });

        if(!existingProduct){
            throw new ApiError(
                "Product not found",
                404
            )
        }

        return prisma.product.update({
            where: { id: productId },
            data: {
                isActive: payload.isActive
            },
            select: {
                id: true,
                sku: true,
                name: true,
                category: true,
                isActive: true,
                sellPricePerUnit: true,
                updatedAt: true,
            }
        })
    }

    static async getActiveProducts(
        actor: any
    ) {

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }


        /*
         * ============================================================
         * GET ACTIVE PRODUCTS
         * ============================================================
         */

        const products =
            await prisma.product.findMany({

                where: {
                    isActive: true
                },

                orderBy: {
                    name: "asc"
                }
            });


        if (products.length === 0) {
            return [];
        }


        /*
         * ============================================================
         * GET ALL INVENTORY BATCHES FOR ACTIVE PRODUCTS
         * ============================================================
         *
         * InventoryBatch stores:
         *
         * availableQtyKG
         * availableQtyLTR
         *
         * There is no generic availableQuantity field.
         * ============================================================
         */

        const inventoryBatches =
            await prisma.inventoryBatch.findMany({

                where: {

                    productId: {
                        in: products.map(
                            product => product.id
                        )
                    },

                    isActive: true
                },

                select: {
                    productId: true,
                    availableQtyKG: true,
                    availableQtyLTR: true
                }
            });


        /*
         * ============================================================
         * BUILD CUMULATIVE STOCK MAP
         * ============================================================
         *
         * Stock is summed across ALL batches of the product.
         * ============================================================
         */

        const stockMap =
            new Map<
                string,
                {
                    kg: number;
                    ltr: number;
                }
            >();


        for (const batch of inventoryBatches) {

            const current =
                stockMap.get(
                    batch.productId
                ) ?? {
                    kg: 0,
                    ltr: 0
                };


            current.kg +=
                Number(
                    batch.availableQtyKG ?? 0
                );


            current.ltr +=
                Number(
                    batch.availableQtyLTR ?? 0
                );


            stockMap.set(
                batch.productId,
                current
            );
        }


        /*
         * ============================================================
         * ADD AVAILABLE STOCK BASED ON PRODUCT OPERATIONAL UNIT
         * ============================================================
         *
         * KG  -> availableQtyKG
         * LTR -> availableQtyLTR
         * MT  -> availableQtyKG / 1000
         * ============================================================
         */

        return products.map(
            product => {

                const stock =
                    stockMap.get(
                        product.id
                    ) ?? {
                        kg: 0,
                        ltr: 0
                    };


                switch (product.operationalUnit) {

                    /*
                     * -----------------------------
                     * KG PRODUCT
                     * -----------------------------
                     */

                    case ProductUnit.KG:

                        return {
                            ...product,

                            availableStockKG:
                                Number(
                                    stock.kg.toFixed(3)
                                )
                        };


                    /*
                     * -----------------------------
                     * LTR PRODUCT
                     * -----------------------------
                     */

                    case ProductUnit.LTR:

                        return {
                            ...product,

                            availableStockLTR:
                                Number(
                                    stock.ltr.toFixed(3)
                                )
                        };


                    /*
                     * -----------------------------
                     * MT PRODUCT
                     * -----------------------------
                     *
                     * Inventory is stored in KG.
                     *
                     * 1000 KG = 1 MT
                     */

                    case ProductUnit.MT:

                        return {
                            ...product,

                            availableStockMT:
                                Number(
                                    (stock.kg / 1000)
                                        .toFixed(3)
                                )
                        };

                    case ProductUnit.NOS:

                        return {
                            ...product,

                            availableStockNOS:
                                Number(
                                    stock.kg.toFixed(3)
                                )
                        };


                    /*
                     * Should never happen because
                     * operationalUnit is ProductUnit.
                     */

                    default:

                        return {
                            ...product,

                            availableStockKG:
                                Number(
                                    stock.kg.toFixed(3)
                                )
                        };
                }
            }
        );
    }
}
