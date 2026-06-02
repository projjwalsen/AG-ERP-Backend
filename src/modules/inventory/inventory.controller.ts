import { Request, Response, NextFunction } from "express";
import { InventoryService } from "./inventory.service";

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

        const result = await InventoryService.getAllInventoryBatches(actor, {
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            productId,
            search,
            isActive: isActive !== undefined ? isActive === "true" : undefined
        });

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
        const { page, limit, branchId, productId, search } = (req as any).query;

        const result = await InventoryService.getBranchInventorySummary(actor, {
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            productId,
            search
        });

        return res.status(200).json({
            success: true,
            message: "Branch inventory summary retrieved successfully",
            data: result
        })
    } catch (error) {
        next(error);
    }
}