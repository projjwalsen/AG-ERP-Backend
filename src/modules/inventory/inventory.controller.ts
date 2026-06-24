import { Request, Response, NextFunction } from "express";
import { InventoryService } from "./inventory.service";
import { ExcelService } from "../../core/utils/export.service";
import { inventoryBatchColumns } from "../exports/invBatch.export";
import { inventorySummaryColumns, productBatchHistoryColumns } from "../exports/brcinv.export";

export const getAvailableBatches = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { branchId, productId, isActive } = (req as any).query;

        const result = await InventoryService.getAvailableBatches(
            actor,
            branchId,
            productId,
            isActive
        );

        return res.status(200).json({
            success: true,
            message: "Available batches retrieved successfully",
            data: result
        })
    } catch (error) {
        next(error);
    }
}



export const getAllInventoryBatches = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { page, limit, branchId, productId, search, isActive } = (req as any).query;
        const isExport = (req.query.export as string) === "true" || false;
        const result = await InventoryService.getAllInventoryBatches(actor, {
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            productId,
            search,
            isActive: isActive !== undefined ? isActive === "true" : undefined,
            export: isExport
        });

        if (isExport) {

            return await ExcelService.export(
                res,
                {
                    filename: "inventory_batches",

                    sheetName: "Inventory Batches",

                    title: "INVENTORY BATCHES",

                    columns:
                        inventoryBatchColumns,

                    data: result.data,

                    filters: {
                        branchId,
                        productId,
                        search,
                        isActive
                    }
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Inventory batches retrieved successfully",
            data: result
        })
    } catch (error) {
        next(error);
    }
}


export const getBranchInventorySummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { page, limit, productId, search } = (req as any).query;
        const isExport = (req.query.export as string) === "true" || false;
        const result = await InventoryService.getBranchInventorySummary(actor, {
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            productId,
            search,
            export: isExport
        });

        if (isExport) {

            return await ExcelService.export(
                res,
                {
                    filename: "branch_inventory_summary",

                    sheetName: "Branch Inventory Summary",

                    title: "BRANCH INVENTORY SUMMARY",

                    columns:
                        inventorySummaryColumns,

                    data: result.data,

                    filters: {
                        productId,
                        search
                    }
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Branch inventory summary retrieved successfully",
            data: result
        })
    } catch (error) {
        next(error);
    }
}


export const getProductBatchWiseHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { productId } = (req as any).params;
        const isExport = (req.query.export as string) === "true" || false;
        const result = await InventoryService.getProductBatchHistory(actor, productId);

        if (isExport) {

            const rows: any[] = [];

            result.branches.forEach(
                branch => {

                    branch.batches.forEach(
                        batch => {

                            rows.push({
                                branchName:
                                    branch.branchName,

                                branchCode:
                                    branch.branchCode,

                                batchNo:
                                    batch.batchNo,

                                purchasePrice:
                                    batch.purchasePrice,

                                availableQtyKG:
                                    batch.availableQtyKG,

                                availableQtyLTR:
                                    batch.availableQtyLTR,

                                isActive:
                                    batch.isActive,

                                createdAt:
                                    batch.createdAt
                            });
                        }
                    );
                }
            );

            return ExcelService.export(
                res,
                {
                    filename:
                        `product_batch_history_${result.product.sku}`,

                    title:
                        `Product Batch-wise History - ${result.product.name} (${result.product.sku})`,

                    sheetName:
                        "Batch History",

                    columns:
                        productBatchHistoryColumns,

                    data:
                        rows
                }
            );
        }



        return res.status(200).json({
            success: true,
            message: "Product batch-wise history retrieved successfully",
            data: result
        })
    } catch (error) {
        next(error);
    }
}