import { Request, Response, NextFunction } from "express";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { ReportingService } from "./reporting.service";
import { ExcelService } from "../../core/utils/export.service";
import { branchDayBookColumns, gstr1Columns, gstSuspenseColumns, outstandingAgingColumns, outstandingColumns, outstandingDetailColumns, stockInventoryColumns, trialBalanceColumns } from "../exports/branch.export";
import { formatISTDate } from "../../core/utils/loc.utils";


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
            endDate: (req as any).query.endDate as string,
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 25
        };

        const bankAccountId = (req as any).query.bankAccountId as string;

        console.log((req as any).query.export as string);
        const isExport =
            String(req.query.export).toLowerCase() === "true";

        const result = await ReportingService.getBranchDayBook(
            actor,
            branchId,
            { ...query, bankAccountId }
        );
        console.log("result", result.entries.length);
        if (isExport) {
            // Exports must include every entry, not just the current page.
            const fullResult =
                await ReportingService.getBranchDayBook(
                    actor,
                    branchId,
                    {
                        ...query,
                        page: 1,
                        limit: result.pagination.totalEntries || 25,
                        bankAccountId
                    }
                );

            console.log("Exporting branch day book report...");
            return ExcelService.export(
                res,
                {
                    filename: "branch-day-book",
                    title: `${result.branch.name} - BRANCH DAY BOOK`,
                    sheetName: "Day Book",
                    columns: branchDayBookColumns,
                    data: fullResult.entries
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

export const getTrialBalanceReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;

        const query = {
            branchId: req.query.branchId as string,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
            includeZero: String(req.query.includeZero).toLowerCase() === "true"
        };

        const isExport =
            String(req.query.export).toLowerCase() === "true";

        const report =
            await ReportingService.getTrialBalanceReport(
                actor,
                query
            );

        if (isExport) {
            const periodText =
                `${report.period.startDate ? formatISTDate(report.period.startDate) : "Opening"} to ${formatISTDate(report.period.endDate)}`;

            return ExcelService.export(
                res,
                {
                    filename: "trial-balance",
                    sheetName: "Trial Balance",
                    title: `Trial Balance - ${periodText}`,
                    columns: trialBalanceColumns,
                    companyName: "ASHTAVINAYAKA",
                    showCompanyName: true,
                    data: [
                        ...report.rows,
                        {
                            ledgerCode: "",
                            ledgerName: "TOTAL",
                            groupName: "",
                            ledgerCategory: "",
                            openingDebit: report.summary.totalOpeningDebit,
                            openingCredit: report.summary.totalOpeningCredit,
                            periodDebit: report.summary.totalPeriodDebit,
                            periodCredit: report.summary.totalPeriodCredit,
                            closingDebit: report.summary.totalClosingDebit,
                            closingCredit: report.summary.totalClosingCredit
                        }
                    ]
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Trial balance report generated successfully",
            data: report
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

                    title: "GSTR-1 Report",

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

                    title:
                        `GST Suspense Account Log`,

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

                    title:
                        "Stock Inventory Report",

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
        const exportType =
            String(req.query.export || "")
                .toUpperCase();
        
        const query = {
            branchId:
                req.query.branchId as string,
            agencyId:
                req.query.agencyId as string,
            type:
                req.query.type as
                    | "RECEIVABLE"
                    | "PAYABLE",
            export:
                ["DETAILS", "AGING", "TRUE"].includes(exportType)
        };

        const report =
            await ReportingService.getOutstandingReport(
                actor,
                query
            );

        switch (exportType) {

            case "DETAILS":

                return ExcelService.export(
                    res,
                    {
                        filename:
                            query.type === "PAYABLE"
                                ? "AP Details"
                                : "AR Details",

                        sheetName:
                            query.type === "PAYABLE"
                                ? "AP Details"
                                : "AR Details",

                        title:
                            query.type === "PAYABLE"
                                ? "Accounts Payable Details Report"
                                : "Accounts Receivable Details Report",

                        columns:
                            outstandingDetailColumns,

                        companyName: "ASHTAVINAYAKA",
                        showCompanyName: true,

                        data:
                            report.exportData
                    }
                );

            case "AGING":

                return ExcelService.export(
                    res,
                    {
                        filename:
                            query.type === "PAYABLE"
                                ? "AP Aging"
                                : "AR Aging",

                        sheetName:
                            "Aging",

                        title:
                            query.type === "PAYABLE"
                                ? "Accounts Payable Aging Report"
                                : "Accounts Receivable Aging Report",

                        columns:
                            outstandingAgingColumns(query.type),

                        companyName: "ASHTAVINAYAKA",
                        showCompanyName: true,

                        data:
                            report.rows
                    }
                );

            case "TRUE":

                return ExcelService.export(
                    res,
                    {
                        filename: "AP / AR Reports",

                        sheetName: "Outstanding",

                        title: "AP / AR Reports",

                        columns: outstandingColumns,

                        companyName: "ASHTAVINAYAKA",
                        showCompanyName: true,

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

export const exportAgencyOutstandingReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor =
            (req as any).user;

        const query = {
            branchId:
                req.query.branchId as string,
            agencyId:
                req.query.agencyId as string,
            type:
                req.query.type as
                    | "PAYABLE"
                    | "RECEIVABLE",

            export: true
        };

        const report =
            await ReportingService.getOutstandingReport(
                actor,
                query
            );

        return ExcelService.export(
            res,
            {

                filename:
                    query.type === "PAYABLE"
                        ? `AP_Outstanding_${report.agency?.name ?? "Agency"}`
                        : `AR_Outstanding_${report.agency?.name ?? "Agency"}`,

                sheetName:
                    query.type === "PAYABLE"
                        ? "Accounts Payable"
                        : "Accounts Receivable",

                title:
                    query.type === "PAYABLE"
                        ? `Accounts Payable Outstanding Report${report.agency ? ` - ${report.agency?.name}` : ""}`
                        : `Accounts Receivable Outstanding Report${report.agency ? ` - ${report.agency?.name}` : ""}`,

                columns:
                    outstandingDetailColumns,

                companyName:
                    "ASHTAVINAYAKA",

                showCompanyName:
                    true,

                data:
                    report.exportData

            }
        );

    } catch (error) {
        next(error);
    }
};
