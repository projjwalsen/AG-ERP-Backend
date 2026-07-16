import { Request, Response, NextFunction } from "express";
import { ProductService } from "./product.service";
import { ExcelService } from "../../core/utils/export.service";
import { productColumns } from "../exports/products.export";

export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            name, sku, category, description, disclaimer,
            hsnNo, applicableGST, baseUnit, density, 
            operationalUnit, minimumStockKG, sellPricePerUnit
        } = req.body;

        const product = await ProductService.createProduct(actor, {
            name, sku, category, description, disclaimer,
            hsnNo, applicableGST, baseUnit, density, 
            operationalUnit, minimumStockKG, sellPricePerUnit
        });

        return res.status(201).json({
            success: true,
            message: "Product created successfully",
            data: { product }
        });
    } catch (error) {
        next(error);
    }
}

export const getAllProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { category, search } = (req as any).query;
        const page     = parseInt(req.query.page as string)     || 1;
        const limit    = parseInt(req.query.limit as string)    || 10;
        const isExport = (req.query.export as string) === "true" || false;

        const result = await ProductService.getAllProducts(actor, { 
            search: search as string ,
            category: category as string,
            page,
            limit,
            export: isExport
        });

        if(isExport) {
             return await ExcelService.export(
                (res as any),
                {
                    filename: `products_${Date.now()}`,

                    sheetName: "Products",

                    title: "PRODUCTS",

                    columns: productColumns,

                    data: result.data,

                    filters: {
                        search,
                        category
                    }
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Products retrieved successfully",
            data: {
                products: result.data,
                meta: result.meta
            }
        });
    } catch (error) {
        next(error);
    }
}

export const getProductById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { productId } = (req as any).params;

        const product = await ProductService.getProductById(actor, productId);

        return res.status(200).json({
            success: true,
            message: "Product retrieved successfully",
            data: { product }
        });
    } catch (error) {
        next(error);
    }
}

export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { productId } = (req as any).params;

        const {
            name, sku, category, description, disclaimer,
            hsnNo, applicableGST, baseUnit, density, 
            operationalUnit, minimumStockKG, sellPricePerUnit
        } = req.body;

        const product = await ProductService.updateProduct(actor, productId, {
            name, sku, category, description, disclaimer,
            hsnNo, applicableGST, baseUnit, density, 
            operationalUnit, minimumStockKG, sellPricePerUnit
        });

        return res.status(200).json({
            success: true,
            message: "Product updated successfully",
            data: { product }
        });
    } catch (error) {
        next(error);
    }
}

export const toggleProductStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { productId } = (req as any).params;
        const { isActive } = req.body;

        const product = await ProductService.toggleProductStatus(actor, productId, {
            isActive
        });

        return res.status(200).json({
            success: true,
            message: "Product status toggled successfully",
            data: { product }
        });
    } catch (error) {
        next(error);
    }
}

export const getActiveProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const products = await ProductService.getActiveProducts(actor);

        return res.status(200).json({
            success: true,
            message: "Active products retrieved successfully",
            data: { products }
        });
    } catch (error) {
        next(error);
    }
}