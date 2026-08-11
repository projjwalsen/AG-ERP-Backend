import {
    Request,
    Response,
    NextFunction
} from "express";
import {
    getImportErrorReport,
    ImportService
} from "./multer.import";
import { JournalImportService } from "./journalImport.service";
import { ProductMasterImportService } from "./productImport.service";
import { AgencyImportService } from "./agencyImport.service";


export const importWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor = (req as any).user;
        // Set headers for Server-Sent Events (SSE)
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const file = req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message: "Excel file is required."

            });

        }

        const type =
            String(req.body.type).toUpperCase()



        if (
            type !== "PURCHASE" &&
            type !== "SALE"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Type must be PURCHASE or SALE."

            });

        }

        const result =
            await ImportService.importWorkbook(
                actor,
                file,
                type,
                (progress) => {
                    res.write(
                        `data: ${JSON.stringify(progress)}\n\n`
                    );
                }
            );

        // final event streaming message to indicate completion
        res.write(
            `event: completed\n`
            + `data: ${JSON.stringify({
                success: true,
                message: `${type} Register imported successfully.`,
                data: {
                    ...result,
                    ...(result.errorReport
                        ? {
                            errorReportUrl:
                                `${req.baseUrl}/import/error-report/${result.errorReport.reportId}`
                        }
                        : {})
                }
            })}\n\n`
        );

        res.end();

    }

    catch (error) {

        next(error);

    }

};

export const importProductWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        const file =
            req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message:
                    "Excel file is required."

            });

        }

        const result =
            await ProductMasterImportService.importWorkbook(

                actor,

                file,

                summary => {

                    res.write(

                        `data: ${JSON.stringify(summary)}\n\n`

                    );

                }

            );

        res.write(

            `event: completed\n` +

            `data: ${JSON.stringify({

                success: true,

                message:
                    "Product Master imported successfully.",

                data: result

            })}\n\n`

        );

        res.end();

    }

    catch (error) {

        next(error);

    }

};

export const importAgencyWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        const file =
            req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message:
                    "Excel file is required."

            });

        }

        const result =
            await AgencyImportService.importWorkbook(

                actor,

                file,

                summary => {

                    res.write(

                        `data: ${JSON.stringify(summary)}\n\n`

                    );

                }

            );

        res.write(

            `event: completed\n` +

            `data: ${JSON.stringify({

                success: true,

                message:
                    "Agency Master imported successfully.",

                data: result

            })}\n\n`

        );

        res.end();

    }

    catch (error) {

        next(error);

    }

};


export const importJournalWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {
        const actor =
            (req as any).user;

        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        const file =
            req.file;

        if (!file) {
            return res.status(400).json({
                success: false,
                message:
                    "Excel file is required."
            });
        }

        const type =
            String(req.query.type || "JOURNAL")
                .toUpperCase() as
                    "JOURNAL" | "TRANSACTION" | "BOTH";

        const fromDate =
            typeof req.body.fromDate === "string"
                ? req.body.fromDate.trim()
                : "";

        const toDate =
            typeof req.body.toDate === "string"
                ? req.body.toDate.trim()
                : "";

        const result =
            await JournalImportService.importWorkbook(
                actor,
                file,
                type,
                fromDate ? new Date(fromDate) : undefined,
                toDate ? new Date(toDate) : undefined,
                summary => {
                    res.write(
                        `data: ${JSON.stringify(summary)}\n\n`
                    );
                }
            );

        res.write(
            `event: completed\n` +
            `data: ${JSON.stringify({
                success: true,
                message:
                    "Journal imported successfully.",
                data: {
                    ...result,
                    ...(result.errorReport
                        ? {
                            errorReportUrl:
                                `${req.baseUrl}/import/error-report/${result.errorReport.reportId}`
                        }
                        : {})
                }
            })}\n\n`
        );

        res.end();
    }

    catch (error) {
        next(error);
    }

};

export const downloadImportErrorReport = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const report = getImportErrorReport(
            (req as any).params.reportId
        );

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Import error report not found or expired."
            });
        }

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${report.fileName}"`
        );

        return res.send(report.buffer);
    } catch (error) {
        next(error);
    }
};
