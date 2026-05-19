import { Request, Response, NextFunction } from "express";
import { BranchService } from "./branch.service";

export const createBranch = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const {
            name, code, gstin, stateCode, addressLine1, addressLine2, city, state, pinCode
        } = req.body;

        const branch = await BranchService.createBranch(actor, {
            name,
            code,
            gstin,
            stateCode,
            addressLine1,
            addressLine2,
            city,
            state,
            pinCode
        });

        return res.status(201).json({
            success: true,
            message: "Branch created successfully",
            data: branch
        });
    } catch (error) {
        next(error);
    }
}

export const getAllBranches = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const branches = await BranchService.getAllBranches(actor);

        return res.status(200).json({
            success: true,
            message: "Branches retrieved successfully",
            data: branches
        });
    } catch (error) {
        next(error);
    }
}

export const getBranchesForSelection = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const branches = await BranchService.getActiveBranchesForSelection(actor);

        return res.status(200).json({
            success: true,
            message: "Branches retrieved successfully",
            data: branches
        });
    } catch (error) {
        next(error);
    }
}

export const getBranchById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { branchId } = (req as any).params;

        const branch = await BranchService.getBranchById(actor, branchId);

        return res.status(200).json({
            success: true,
            message: "Branch retrieved successfully",
            data: branch
        });

    } catch (error) {
        next(error);
    }
}

export const updateBranch = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { branchId } = (req as any).params;

        const {
            name,
            code,
            gstin,
            stateCode,
            addressLine1,
            addressLine2,
            city,
            state,
            pinCode,
        } = req.body;

        const branch = await BranchService.updateBranch(actor, branchId, {
            name,
            code,
            gstin,
            stateCode,
            addressLine1,
            addressLine2,
            city,
            state,
            pinCode,
        });

        return res.status(200).json({
            success: true,
            message: "Branch updated successfully",
            data: branch
        });
    } catch (error) {
        next(error);
    }
}

export const toggleBranchStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { branchId } = (req as any).params;
        const { isActive } = req.body;

        const branch = await BranchService.toggleBranchStatus(actor, branchId, {
            isActive
        });

        return res.status(200).json({
            success: true,
            message: "Branch status updated successfully",
            data: branch
        });
    } catch (error) {
        next(error);
    }
}