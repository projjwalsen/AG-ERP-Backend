import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { formatISTDateOnly } from "../../core/utils/loc.utils";
import { FakeTrialBalanceService } from "./fake-trial-balance.service";

export const getFakeTrialBalanceReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const report = FakeTrialBalanceService.getFakeTrialBalanceReport();
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
            message: "Fake trial balance report generated successfully",
            data: report
        });
    } catch (error) {
        next(error);
    }
};
