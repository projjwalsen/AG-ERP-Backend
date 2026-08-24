import { JournalService } from "../journal/journal.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import pLimit from "p-limit";
import { Express } from "express";
import { createImportErrorReport } from "./multer.import";

export class JournalImportService {

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        type: "JOURNAL" | "TRANSACTION" | "BOTH",
        fromDate?: Date,
        toDate?: Date,
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

        const types =
            [...new Set(vouchers.map(x => x.voucherType))];

        console.log(types);

        let rowsToImport = vouchers;

        /**
         * ----------------------------------------
         * Optional Date Filter
         * ----------------------------------------
         */
        if (fromDate || toDate) {

            const from =
                fromDate
                    ? fromDate.toISOString().slice(0, 10)
                    : undefined;

            const to =
                toDate
                    ? toDate.toISOString().slice(0, 10)
                    : undefined;

            rowsToImport = vouchers.filter(dto => {

                if (!dto.date) {
                    return false;
                }

                const current =
                    dto.date
                        .toISOString()
                        .slice(0, 10);

                if (from && current < from) {
                    return false;
                }

                if (to && current > to) {
                    return false;
                }

                return true;

            });

        }

        console.log(
            "Rows To Import:",
            rowsToImport.length
        );

        const data =
            rowsToImport.filter(dto => {

                const voucherType =
                    (dto.voucherType ?? "")
                        .trim()
                        .toUpperCase();

                const isCancelled =
                    ImportResolver.isCancelledTransactionImportRow(dto);

                const isInvoiceTransaction =
                    ["PURCHASE", "TAX INVOICE"].includes(voucherType);

                const isDebitCreditNote =
                    ImportResolver.isDebitCreditNoteImportRow(dto);

                const isTransaction =
                    isInvoiceTransaction || isCancelled;

                switch (type) {

                    case "JOURNAL":
                        return !isTransaction;

                    case "TRANSACTION":
                        return isTransaction || isDebitCreditNote;

                    case "BOTH":
                        return true;

                    default:
                        return false;

                }

            });

        const summary: any = {

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

                       const voucherType =
                            (dto.voucherType ?? "")
                                .trim()
                                .toUpperCase();

                        const isCancelled =
                            ImportResolver.isCancelledTransactionImportRow(dto);
                        const isInvoiceTransaction =
                            ["PURCHASE", "TAX INVOICE"].includes(voucherType);
                        const isDebitCreditNote =
                            ImportResolver.isDebitCreditNoteImportRow(dto);

                        // -----------------------------
                        // Journal Import
                        // -----------------------------
                        if (
                            (
                                type === "JOURNAL" ||
                                type === "BOTH" ||
                                (type === "TRANSACTION" && isDebitCreditNote)
                            ) &&
                            !isInvoiceTransaction &&
                            !isCancelled
                        ) {

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

                        // -----------------------------
                        // Invoice Transaction Import
                        // -----------------------------
                        if (
                            (type === "TRANSACTION" || type === "BOTH")
                            &&
                            (isInvoiceTransaction || isCancelled)
                        ) {

                            await ImportResolver.importInvoiceTransaction(
                                actor,
                                dto
                            );

                        }

                        summary.success++;

                    }

                    catch (error: any) {

                        summary.failed++;

                        summary.errors.push({

                            voucherNo:
                                dto.voucherNo,

                            invoiceNo:
                                dto.invoiceNo,

                            voucherType:
                                dto.voucherType,

                            error:
                                error.message,

                            meta:
                                dto

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

        if (summary.errors.length > 0) {
            summary.errorReport =
                await createImportErrorReport(
                    worksheet,
                    summary.errors,
                    8,
                    `journal-${type.toLowerCase()}`
                );
        }

        return summary;

    }

}
