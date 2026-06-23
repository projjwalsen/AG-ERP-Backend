import { Request, Response, NextFunction } from "express";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { ReportingService } from "./reporting.service";
import { ExcelService } from "../../core/utils/export.service";
import { branchDayBookColumns, gstr1Columns, gstSuspenseColumns, outstandingColumns, stockInventoryColumns } from "../exports/branch.export";


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

        console.log((req as any).query.export as string);
        const isExport =
            String(req.query.export).toLowerCase() === "true";

        const result = await ReportingService.getBranchDayBook(
            actor,
            branchId,
            query
        );
        console.log("result", result.entries.length);
        if (isExport) {
            console.log("Exporting branch day book report...");
            return ExcelService.export(
                res,
                {
                    filename: "branch-day-book",
                    sheetName: "Day Book",
                    columns: branchDayBookColumns,
                    data: result.entries
                }
            );
        }

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

        const isExport = (req.query.export as string) === "true" || false;

        const report =
            await ReportingService.getGSTR1Report(
                actor,
                query
            );

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename: "gstr1-report",

                    sheetName: "GSTR1",

                    columns: gstr1Columns,

                    data: report.rows
                }
            );
        }

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

        const isExport = (req.query.export as string) === "true" || false;

        const suspenseLog =
            await ReportingService.getGSTSuspenseAccountLog(
                actor,
                query
            );

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename:
                        "gst-suspense-log",

                    sheetName:
                        "GST Suspense",

                    columns:
                        gstSuspenseColumns,

                    data:
                        suspenseLog.rows
                }
            );
        }

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

        const isExport = (req.query.export as string) === "true" || false;

        const report =
            await ReportingService.getStockInventoryReport(
                actor,
                query
            );

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename: "stock-inventory",

                    sheetName:
                        "Stock Inventory",

                    columns:
                        stockInventoryColumns,

                    data:
                        report.rows
                }
            );
        }

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

export const getOutstandingReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor = (req as any).user;

        const query = {
            branchId: req.query.branchId as string,
            type: req.query.type as
                | "RECEIVABLE"
                | "PAYABLE"
        };

        const isExport = (req.query.export as string) === "true" || false;

        const report =
            await ReportingService.getOutstandingReport(
                actor,
                query
            );

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename: "outstanding-report",

                    sheetName: "Outstanding",

                    columns: outstandingColumns,

                    data: report.rows
                }
            );
        }

        return res.status(200).json({
            success: true,
            data: report
        });

    } catch (error) {
        next(error);
    }
};