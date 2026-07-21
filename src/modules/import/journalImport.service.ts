import { JournalService } from "../journal/journal.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import pLimit from "p-limit";

export class JournalImportService {

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        type: "JOURNAL" | "TRANSACTION",
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

        const limit = pLimit(1);

        
        const vouchers =
            ExcelImportService.parseJournalRows(rows);

        const types = [...new Set(vouchers.map(x => x.voucherType))];
        console.log(types);

        const data =
            vouchers.filter(dto => {

                const voucherType =
                    dto.voucherType
                        ?.trim()
                        .toUpperCase();

                if (type === "JOURNAL") {

                    return ![
                        "PURCHASE",
                        "TAX INVOICE"
                    ].includes(voucherType);

                }

                // TRANSACTION: Import only Purchase vouchers.
                return voucherType === "PURCHASE";

            });

        const summary = {

            total: data.length,

            processed: 0,

            success: 0,

            failed: 0,

            percentage: 0,

            errors: [] as any[]

        };

        await Promise.all(

            data.map(dto =>

                limit(async () => {

                    try {

                        if (type === "JOURNAL") {

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

                        }

                        else {

                            await ImportResolver.importInvoiceTransaction(
                                actor,
                                dto
                            );

                        }

                        summary.success++;

                    }

                    catch (error: any) {

                        if (
                            error.message ===
                            "SKIP_ALREADY_IMPORTED"
                        ) {

                            summary.success++;

                            return;

                        }

                        summary.failed++;

                        summary.errors.push({

                            voucherNo:
                                dto.voucherNo,

                            voucherType:
                                dto.voucherType,

                            error:
                                error.message

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

    }

}