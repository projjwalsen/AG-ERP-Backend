import { NextFunction, Request, Response } from "express";
import {
    FinancialStatementReport,
    Srv1FinancialStatementsService
} from "./financial-statements.service";

const sendReport = async (
    req: Request,
    res: Response,
    next: NextFunction,
    report: FinancialStatementReport,
    exportName: string,
    sheetName: string
) => {
    try {
        if (["true", "xlsx"].includes(String(req.query.export ?? "").toLowerCase())) {
            return await Srv1FinancialStatementsService.exportExcel(res, report, exportName, sheetName);
        }
        return res.status(200).json({
            success: true,
            message: `${report.reportName} report generated successfully`,
            data: report
        });
    } catch (error) {
        return next(error);
    }
};

export const getSrv1ProfitAndLossReport = (req: Request, res: Response, next: NextFunction) =>
    sendReport(
        req, res, next,
        Srv1FinancialStatementsService.getProfitAndLossReport(),
        "srv1-profit-and-loss",
        "Profit & Loss"
    );

export const getSrv1BalanceSheetReport = (req: Request, res: Response, next: NextFunction) =>
    sendReport(
        req, res, next,
        Srv1FinancialStatementsService.getBalanceSheetReport(),
        "srv1-balance-sheet",
        "Balance Sheet"
    );

const liveStatementQuery = (req: Request) => {
    const branchId = String(req.query.branchId ?? "").trim() || undefined;
    const startDate = String(req.query.startDate ?? "").trim() || undefined;
    const endDate = String(req.query.endDate ?? "").trim() || undefined;
    const includeZero = String(req.query.includeZero ?? "").toLowerCase() === "true";
    return { branchId, startDate, endDate, includeZero };
};

export const getLiveProfitAndLossReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const report = await Srv1FinancialStatementsService.getLiveProfitAndLossReport(
            (req as any).user,
            liveStatementQuery(req)
        );
        return sendReport(req, res, next, report, "profit-and-loss", "Profit & Loss");
    } catch (error) {
        return next(error);
    }
};

export const getLiveBalanceSheetReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const report = await Srv1FinancialStatementsService.getLiveBalanceSheetReport(
            (req as any).user,
            liveStatementQuery(req)
        );
        return sendReport(req, res, next, report, "balance-sheet", "Balance Sheet");
    } catch (error) {
        return next(error);
    }
};
