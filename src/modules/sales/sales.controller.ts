import { Request, Response, NextFunction } from "express";
import { SalesService } from "./sales.service";

export const createSale = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            agencyId,
            branchId,
            remarks,
            deliveryNote,
            suppliersRef,
            otherReference,
            buyerOrderNo,
            buyerOrderDate,
            despatchDocNo,
            despatchDocDate,
            despatchThrough,
            destination,
            items
        } = req.body;

        const sale = await SalesService.createSale(actor, {
            agencyId,
            branchId,
            remarks,
            deliveryNote,
            suppliersRef,
            otherReference,
            buyerOrderNo,
            buyerOrderDate,
            despatchDocNo,
            despatchDocDate,
            despatchThrough,
            destination,
            items
        });

        return res.status(201).json({
            success: true,
            message: "Sale created successfully",
            data: sale
        })
        
    } catch (error) {
        next(error);
    }
}


export const getAllSales = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const { page, limit, branchId, status } = (req as any).query;

        const sales = await SalesService.getAllSales(actor, { 
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            status
        });

        return res.status(200).json({
            success: true,
            message: "Sales retrieved successfully",
            data: sales
        });
    } catch (error) {
        next(error);
    }
}


export const getSaleById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { saleId } = (req as any).params;

        const sale = await SalesService.getSaleById(actor, saleId);

        return res.status(200).json({
            success: true,
            message: "Sale retrieved successfully",
            data: sale
        });

    } catch (error) {
        next(error);
    }
}


export const approveSale = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { saleId } = (req as any).params;

        const approvedSale = await SalesService.approveSale(actor, saleId);

        return res.status(200).json({
            success: true,
            message: "Sale approved successfully",
            data: approvedSale
        });
    } catch (error) {
        next(error);
    }
}


export const rejectSale = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { saleId } = (req as any).params;
        const { remarks } = req.body;

        const rejectedSale = await SalesService.rejectSale(actor, saleId, remarks);

        return res.status(200).json({
            success: true,
            message: "Sale rejected successfully",
            data: rejectedSale
        });
    } catch (error) {
        next(error);
    }
}


export const updateSale = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { saleId } = (req as any).params;
        const {
            agencyId,
            branchId,
            remarks,
            deliveryNote,
            suppliersRef,
            otherReference,
            buyerOrderNo,
            buyerOrderDate,
            despatchDocNo,
            despatchDocDate,
            despatchThrough,
            destination,
            items
        } = req.body;

        const updatedSale = await SalesService.updateSale(actor, saleId, {
            agencyId,
            branchId,
            remarks,
            deliveryNote,
            suppliersRef,
            otherReference,
            buyerOrderNo,
            buyerOrderDate,
            despatchDocNo,
            despatchDocDate,
            despatchThrough,
            destination,
            items
        });

        return res.status(200).json({
            success: true,
            message: "Sale updated successfully",
            data: updatedSale
        });
    } catch (error) {
        next(error);
    }
}


export const downloadSalesInvoicePdf = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { saleId } = (req as any).params;

        const pdfBuffer = await SalesService.downloadInvoicePDF(actor, saleId);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=sale_${saleId}_invoice.pdf`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
}



export const previewSalesInvoice = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { saleId } = (req as any).params;

        const pdfBuffer = await SalesService.previewInvoice(actor, saleId);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename=sale_${saleId}_invoice.pdf`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
}