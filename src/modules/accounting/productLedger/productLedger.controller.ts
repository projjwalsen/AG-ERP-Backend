import { Request, Response, NextFunction } from "express";
import { ProductLedgerService } from "./productLedger.service";
import { ProductMovementType } from "@prisma/client";
import { ExcelService } from "../../../core/utils/export.service";
import { productLedgerColumns, productMovementColumns } from "../../exports/product.export";

/**
 * ========================================
 * PRODUCT LEDGER CONTROLLER
 * ========================================
 * REST API endpoints for product ledger operations
 * Pattern: Simple handlers matching SettingController style
 */

/**
 * GET /api/product-ledger/:productId/detail
 * MAIN ENDPOINT - Product overview with paginated movements
 * 
 * Query Parameters:
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - movementType: string (filter by PURCHASE, SALE, etc)
 * - branchId: string (filter by branch)
 * 
 * Returns: Product metadata, stock, analytics, paginated movements (NO balance)
 */
export const getProductLedgerDetail = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = (req as any).params;

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: "Product ID is required"
            });
        }

        const query = {
            page: Number(req.query.page || 1),

            limit: Number(req.query.limit || 20),

            movementType:
                req.query.movementType as ProductMovementType | undefined,

            branchId:
                req.query.branchId as string | undefined,

            startDate:
                req.query.startDate as string | undefined,

            endDate:
                req.query.endDate as string | undefined,
        };
        const isExport = (req.query.export as string) === "true" || false;

        const detail = await ProductLedgerService.getProductDetails(productId, { ...query, export: isExport });

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename:
                        `product_movements_${detail.product.sku}`,

                    title:
                        `Product Movements - ${detail.product.name} (${detail.product.sku})`,

                    sheetName:
                        detail.product.name,

                    columns:
                        productMovementColumns,

                    data:
                        detail.movements.entries
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Product ledger detail retrieved successfully",
            data: detail
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/product-ledger/:productId/full-history
 * COMPLETE AUDIT ENDPOINT - Everything with full movement history
 * 
 * Query Parameters:
 * - movementType: string (filter by movement type)
 * - branchId: string (filter by branch)
 * - startDate: ISO date string (filter by date range)
 * - endDate: ISO date string (filter by date range)
 * 
 * Returns: Product metadata, stock, analytics, FULL movement history with running balance (NOT paginated)
 */
export const getProductLedgerFullHistory = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = (req as any).params;

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: "Product ID is required"
            });
        }

        const query = {
            movementType: req.query.movementType as ProductMovementType | undefined,
            branchId: req.query.branchId as string | undefined,
            startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        };

        const history = await ProductLedgerService.getProductLedgerFullHistory(productId, query);

        return res.status(200).json({
            success: true,
            message: "Product ledger full history retrieved successfully",
            data: history
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/product-ledger/:productId/branch-stock
 * Get branch-wise stock distribution for a product
 * 
 * Returns: Array of branches with their current stock quantities
 */
// export const getProductBranchStock = async (
//     req: Request,
//     res: Response,
//     next: NextFunction
// ) => {
//     try {
//         const { productId } = (req as any).params;

//         if (!productId) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Product ID is required"
//             });
//         }

//         const branchStock = await ProductLedgerService.getBranchWiseStock(productId);

//         return res.status(200).json({
//             success: true,
//             message: "Branch-wise stock retrieved successfully",
//             data: branchStock
//         });
//     } catch (error) {
//         next(error);
//     }
// };

/**
 * GET /api/product-ledger
 * Get list of all products with their ledger status and stock
 * 
 * Query Parameters:
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - search: string (search by product name or SKU)
 * - category: string (filter by category)
 * - isLowStock: boolean (filter low stock products)
 * 
 * Returns: Paginated list of products with stock status (optimized - no N+1)
 */
export const getAllProductLedgers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const query = {
            page: req.query.page ? Number(req.query.page) : 1,
            limit: req.query.limit ? Number(req.query.limit) : 20,
            search: req.query.search as string | undefined,
            category: req.query.category as string | undefined,
            isLowStock: req.query.isLowStock === 'true' ? true : undefined,
        };
        const isExport = (req.query.export as string) === "true" || false;
        const ledgers = await ProductLedgerService.getAllProductLedgers({ ...query, export: isExport });

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename: "product-ledgers",

                    sheetName:
                        "Product Ledgers",
                    title:
                        "Product Ledger" ,

                    columns:
                        productLedgerColumns,

                    data:
                        ledgers.data,

                    customRowStyles:
                        (row) => {

                            if (row.isLowStock) {
                                return {
                                    fill: {
                                        type: "pattern",
                                        pattern: "solid",
                                        fgColor: {
                                            argb: "FFF2CC"
                                        }
                                    }
                                };
                            }

                            return {};
                        }
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Product ledgers retrieved successfully",
            data: ledgers
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/product-ledger/:productId/stock
 * Get global stock for a specific product
 * 
 * Returns: Global stock across all branches
 */
export const getProductStock = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = (req as any).params;

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: "Product ID is required"
            });
        }

        const stock = await ProductLedgerService.getGlobalProductStock(productId);

        return res.status(200).json({
            success: true,
            message: "Global stock retrieved successfully",
            data: stock
        });
    } catch (error) {
        next(error);
    }
};
