import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { outstandingAgingColumns, outstandingColumns, outstandingDetailColumns } from "../exports/branch.export";
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
        const report = Srv1APARService.getSrv1APARReport(
            type,
            ["DETAILS", "AGING", "TRUE"].includes(exportType)
        );

        switch (exportType) {
            case "DETAILS":
                return ExcelService.export(res, {
                    filename: type === "PAYABLE" ? "AP Details" : "AR Details",
                    sheetName: type === "PAYABLE" ? "AP Details" : "AR Details",
                    title: type === "PAYABLE"
                        ? "Accounts Payable Details Report"
                        : "Accounts Receivable Details Report",
                    columns: outstandingDetailColumns,
                    companyName: "ASHTAVINAYAKA",
                    showCompanyName: true,
                    data: report.exportData
                });
            case "AGING":
                return ExcelService.export(res, {
                    filename: type === "PAYABLE" ? "AP Aging" : "AR Aging",
                    sheetName: "Aging",
                    title: type === "PAYABLE"
                        ? "Accounts Payable Aging Report"
                        : "Accounts Receivable Aging Report",
                    columns: outstandingAgingColumns(type),
                    companyName: "ASHTAVINAYAKA",
                    showCompanyName: true,
                    data: report.rows
                });
            case "TRUE":
                return ExcelService.export(res, {
                    filename: "AP AR Report",
                    sheetName: "Outstanding",
                    title: "AP / AR Report",
                    columns: outstandingColumns,
                    companyName: "ASHTAVINAYAKA",
                    showCompanyName: true,
                    data: report.rows
                });
            default:
                return res.status(200).json({
                    success: true,
                    message: "SRV1 AP / AR report generated successfully",
                    data: report
                });
        }
    } catch (error) {
        next(error);
    }
};
