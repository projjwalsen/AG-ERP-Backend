import {
    Request,
    Response,
    NextFunction
} from "express";
import { ImportService } from "./multer.import";
import { JournalImportService } from "./journalImport.service";


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
                    "JOURNAL" | "TRANSACTION";

        const result =
            await JournalImportService.importWorkbook(
                actor,
                file,
                type,
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
                data: result
            })}\n\n`
        );

        res.end();
    }

    catch (error) {
        next(error);
    }

};