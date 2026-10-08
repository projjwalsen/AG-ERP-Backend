import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { Srv1APARService } from "./ap-ar.service";

type ReportType = "PAYABLE" | "RECEIVABLE";

export const getSrv1APARReport = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const type = String(req.query.type || "").toUpperCase() as ReportType;
        if (type !== "PAYABLE" && type !== "RECEIVABLE") {
            return res.status(400).json({
                success: false,
                message: "type must be PAYABLE or RECEIVABLE."
            });
        }

        const exportType = String(req.query.export || "").toUpperCase();
        const report = await Srv1APARService.getSrv1APARReport(
            type
        );

        if (["DETAILS", "AGING", "TRUE"].includes(exportType)) {
            return ExcelService.exportSrv1APARGroupReport(res, {
                filename: type === "PAYABLE" ? "Debtor" : "Credtor",
                sheetName: type === "PAYABLE" ? "Sundry Debtor" : "Sundry Creditor",
                report
            });
        }

        return res.status(200).json({
            success: true,
            message: "SRV1 AP / AR report generated successfully",
            data: report
        });
    } catch (error) {
        next(error);
    }
};
