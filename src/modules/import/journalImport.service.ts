import { JournalService } from "../journal/journal.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import pLimit from "p-limit";

export class JournalImportService {

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        onProgress?: (summary: any) => void
    ) {

        ImportResolver.clearCache();

        const workbook =
            ExcelImportService.readExcel(file.buffer);

        const worksheet =
            ExcelImportService.getWorkSheet(workbook);

        const rows =
            ExcelImportService.readRows(
                worksheet,
                {
                    headerRow: 8
                }
            );

        const journals =
            ExcelImportService.parseJournalRows(rows);

        const summary = {

            total: journals.length,

            processed: 0,

            success: 0,

            failed: 0,

            percentage: 0,

            errors: [] as any[]

        };

        const limit = pLimit(1);

        await Promise.all(

            journals.map(dto =>

                limit(async () => {

                    try {

                        console.log(
                            dto.voucherType,
                            dto.voucherNo,
                            dto.particulars,
                            dto.debitAmount,
                            dto.creditAmount
                        );

                        const payload =
                            await ImportResolver.buildJournalPayload(
                                actor,
                                dto
                            );

                        const journal =
                            await JournalService.createJournal(
                                actor,
                                payload
                            );

                        await JournalService.approveJournal(
                            actor,
                            journal.id
                        );

                        summary.success++;

                    }

                    catch (error: any) {

                        console.log({
                            error: error,
                            message: error.message,
                            name: error.name,
                            status: error.status,
                            statusCode: error.statusCode
                        });

                        if (error.message === "SKIP_ALREADY_IMPORTED") {
                            console.log(">>> SKIPPED");
                            summary.success++;
                            return;
                        }

                        summary.failed++;

                        summary.errors.push({
                            voucherNo: dto.voucherNo,
                            voucherType: dto.voucherType,
                            error: error.message
                        });

                    }

                    finally {

                        summary.processed++;

                        summary.percentage =

                            Number(

                                (

                                    summary.processed /

                                    summary.total *

                                    100

                                ).toFixed(2)

                            );

                        onProgress?.(summary);

                    }

                })

            )

        );

        return summary;

    }

}