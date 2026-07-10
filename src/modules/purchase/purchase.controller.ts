import { Request, Response, NextFunction } from "express";
import { PurchaseService } from "./purchase.service";

export const createPurchase = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            agencyId,
            branchId,
            invoiceNo,

            invoiceDate,
            supplierInvoiceDate,

            otherReference,

            roundOffAmount,

            remarks,

            transport,

            items,
        } = req.body;

        const newPurchase = await PurchaseService.createPurchase(actor, {
            agencyId,
            branchId,
            invoiceNo,
            invoiceDate,
            supplierInvoiceDate,
            otherReference,
            roundOffAmount,
            remarks,
            transport,
            items,
        });

        return res.status(201).json({
            success: true,
            message: "Purchase created successfully",
            data: newPurchase
        });
    } catch (error) {
        next(error);
    }
}


export const getAllPurchases = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { page, limit, branchId, status } = (req as any).query;

        const purchases = await PurchaseService.getAllPurchases(actor, { 
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            status
        });

        return res.status(200).json({
            success: true,
            message: "Purchases retrieved successfully",
            data: purchases
        });

    } catch (error) {
        next(error);
    }
}


export const getPurchaseById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { purchaseId } = (req as any).params;

        const purchase = await PurchaseService.getPurchaseById(actor, purchaseId);

        return res.status(200).json({
            success: true,
            message: "Purchase retrieved successfully",
            data: purchase
        });
    } catch (error) {
        next(error);
    }
}


export const approvePurchase = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { purchaseId } = (req as any).params;

        const approvedPurchase = await PurchaseService.approvePurchase(actor, purchaseId);

        return res.status(200).json({
            success: true,
            message: "Purchase approved successfully",
            data: approvedPurchase
        });
    } catch (error) {
        next(error);
    }
}


export const rejectPurchase = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { purchaseId } = (req as any).params;

        const rejectedPurchase = await PurchaseService.rejectPurchase(actor, purchaseId);

        return res.status(200).json({
            success: true,
            message: "Purchase rejected successfully",
            data: rejectedPurchase
        });
    } catch (error) {
        next(error);
    }
}


export const updatePurchase = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { purchaseId } = (req as any).params;
        const {
            agencyId,
            branchId,
            invoiceNo,
            invoiceDate,
            supplierInvoiceDate,
            otherReference,
            roundOffAmount,
            remarks,
            transport,
            items,
        } = req.body;

        const updatedPurchase = await PurchaseService.updatePurchase(actor, purchaseId, {
            agencyId,
            branchId,
            invoiceNo,
            invoiceDate,
            supplierInvoiceDate,
            otherReference,
            roundOffAmount,
            remarks,
            transport,
            items,
        });

        return res.status(200).json({
            success: true,
            message: "Purchase updated successfully",
            data: updatedPurchase
        });
    } catch (error) {
        next(error);
    }
}