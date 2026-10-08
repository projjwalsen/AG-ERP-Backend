import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { Srv1TrialBalanceService } from "./trial-balance.service";

export const getSrv1TrialBalanceReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const report = Srv1TrialBalanceService.getSrv1TrialBalanceReport();
        const isExport = String(req.query.export).toLowerCase() === "true";

        if (isExport) {
            return ExcelService.exportTrialBalanceSourceRows(res, {
                filename: "trial-balance",
                sheetName: "Trial Balance",
                report
            });
        }

        return res.status(200).json({
            success: true,
            message: "SRV1 Trial Balance report generated successfully",
            data: report
        });
    } catch (error) {
        next(error);
    }
};
