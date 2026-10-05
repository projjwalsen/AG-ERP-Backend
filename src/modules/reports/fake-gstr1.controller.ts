import { Request, Response, NextFunction } from "express";
import { ExcelService } from "../../core/utils/export.service";
import { FakeGSTR1Service } from "./fake-gstr1.service";

export const getFakeGSTR1Report = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const report = FakeGSTR1Service.getFakeGSTR1Report();
        const isExport = String(req.query.export || "").toLowerCase() === "true";

        if (isExport) {
            return ExcelService.exportGSTR1Summary(res, report, {
                filename: "fake-gstr1-report",
                sheetName: "GSTR-1",
                title: "Fake GSTR-1 - Summary"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Fake GSTR-1 report generated successfully",
            data: report
        });
    } catch (error) {
        next(error);
    }
};
