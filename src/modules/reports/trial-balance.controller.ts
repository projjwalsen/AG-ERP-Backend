import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { formatISTDateOnly } from "../../core/utils/loc.utils";
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
            const period = `${report.period.startDate
                ? formatISTDateOnly(report.period.startDate)
                : "Beginning"} to ${formatISTDateOnly(report.period.endDate)}`;

            return ExcelService.exportTrialBalance(res, {
                filename: "trial-balance",
                sheetName: "Trial Balance",
                companyName: report.branch.name,
                branchName: report.branch.name,
                period,
                data: report.rows,
                tree: report.tree,
                summary: report.summary
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
