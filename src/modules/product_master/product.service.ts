import { ProductType, ProductUnit } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { convertKGToLTR } from "../../core/utils/density.utils";
import { ProductLedgerService } from "../accounting/productLedger/productLedger.service";

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
            payload.baseUnit === ProductUnit.KG
        ) {
            sellPriceLTR =
                Number(
                    (
                        normalizedPrice *
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
            (payload.baseUnit || "KG") === "KG" &&
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

        const product = await prisma.product.create({
            data: {
                sku: normalizedSKU,
                name: payload.name.trim(),
                category: payload.category.trim(),
                productType: payload.productType || ProductType.PURCHASED,
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
            product.id
        );

        return {
            ...product,
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
        const category = query?.category?.trim();
        const page     = query?.page  || 1;
        const limit    = query?.limit || 10;
        const skip     = (page - 1) * limit;

        const where = {
            ...(category && {
                category: { contains: category, mode: "insensitive" as const }
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
            payload.baseUnit === "KG" &&
            operationalUnit === "LTR" &&
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
            baseUnit === ProductUnit.KG
        ) {
            sellPriceLTR =
                Number(
                    (
                        finalSellPrice *
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
        actor: any,   
    ){
        if(!actor?.id){
            throw new ApiError(
                "Unauthorized",
                401
            )
        }

        const products = await prisma.product.findMany({
            where: {
                isActive: true
            },
            orderBy: {
                name: "asc"
            }
        });
        return products;
    }
}
