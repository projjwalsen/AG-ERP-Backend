import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { Srv1GSTR1Service } from "./gstr1.service";

export const getSrv1GSTR1Report = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const report = Srv1GSTR1Service.getSrv1GSTR1Report();
        const isExport = String(req.query.export || "").toLowerCase() === "true";

        if (isExport) {
            return ExcelService.exportGSTR1Summary(res, report, {
                filename: "gstr1-report",
                sheetName: "GSTR-1",
                title: "GSTR-1 - Summary"
            });
        }

        return res.status(200).json({
            success: true,
            message: "SRV1 GSTR-1 report generated successfully",
            data: report
        });
    } catch (error) {
        next(error);
    }
};
