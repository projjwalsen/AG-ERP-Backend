import { Request, Response, NextFunction } from "express";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { ReportingService } from "./reporting.service";


export const getBranchDayBook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;
        const { branchId } = (req as any).params;

        const query = {
            startDate: (req as any).query.startDate as string,
            endDate: (req as any).query.endDate as string
        };

        const result = await ReportingService.getBranchDayBook(
            actor,
            branchId,
            query
        );

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        next(error);
    }
}


export const getGSTR1Report = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor = (req as any).user;

        const query = {
            branchId:
                req.query.branchId as string,

            startDate:
                req.query.startDate as string,

            endDate:
                req.query.endDate as string
        };

        const report =
            await ReportingService.getGSTR1Report(
                actor,
                query
            );

        return res.status(200).json({
            success: true,
            message:
                "GSTR-1 report generated successfully",
            data: report
        });

    } catch (error) {
        next(error);
    }
};

export const getGSTSuspenseAccountLog = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;

        const query = {
            branchId:
                req.query.branchId as string,
            startDate:
                req.query.startDate as string,
            endDate:
                req.query.endDate as string
        };

        const suspenseLog =
            await ReportingService.getGSTSuspenseAccountLog(
                actor,
                query
            );

        return res.status(200).json({
            success: true,
            data: suspenseLog
        });
    } catch (error) {
        next(error);
    }
};


export const getStockInventoryReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor = (req as any).user;

        const query = {
            branchId: req.query.branchId as string,
            productId: req.query.productId as string,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
        };

        const report =
            await ReportingService.getStockInventoryReport(
                actor,
                query
            );

        return res.status(200).json({
            success: true,
            message:
                "Stock inventory report generated successfully",
            data: report
        });

    } catch (error) {
        next(error);
    }
};