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
