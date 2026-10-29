import { JournalService } from "../journal/journal.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import pLimit from "p-limit";
import { Express } from "express";
import { createImportErrorReport } from "./multer.import";
import { prisma } from "../../config/db";
import { LedgerService } from "../accounting/ledger/ledger.service";

const SPECIAL_PURCHASE_TYPES = [
    "IGST PURCHASE", "GST PURCHASE", "CST PURCHASE", "DISCOUNT PURCHASE",
    "HIGH SEAS PURCHASE", "IMPORT PURCHASE", "VAT PURCHASE",
    "INTEREST SAUNDRY CREDITORS"
];

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

        const sources = workbook.SheetNames.map(sheetName => {
            const worksheet = ExcelImportService.getWorkSheet(workbook, sheetName);
            return {
                sheetName,
                worksheet,
                // Journal exports do not all place their report title on the
                // same number of rows. Detect the actual register header so
                // RCM Purchase columns are not silently read as empty data.
                headerRow: ExcelImportService.detectJournalHeaderRow(worksheet)
            };
        });

        // Rows are committed in separate transactions. Serialising this
        // import prevents concurrent hierarchy creation from leaving cached
        // ids that belong to a transaction which later rolled back.
        const limit = pLimit(1);

        
        const vouchers = sources.flatMap(source =>
            ExcelImportService.parseJournalRows(
                ExcelImportService.readRows(source.worksheet, {
                    headerRow: source.headerRow
                }),
                source.sheetName
            )
        );

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
                        .toUpperCase()
                        .replace(/_/g, " ");

                const isCancelled =
                    ImportResolver.isCancelledTransactionImportRow(dto);

                const isInvoiceTransaction =
                    ["PURCHASE", "TAX INVOICE", ...SPECIAL_PURCHASE_TYPES].includes(voucherType);

                const isDebitCreditNote =
                    ImportResolver.isDebitCreditNoteImportRow(dto);

                const isRcmNoteRegister =
                    ["RCM DEBIT NOTE", "RCM CREDIT NOTE"].includes(voucherType);

                const isExplicitJournalVoucher =
                    ["CASH PAYMENT", "CASH RECEIPT", "BANK PAYMENT", "BANK RECEIPT", "RECEIPT", "PAYMENT", "OPENING BALANCE"].includes(voucherType);

                const isTransaction =
                    isInvoiceTransaction || isCancelled || isDebitCreditNote;

                switch (type) {

                    case "JOURNAL":
                        return !isTransaction || isRcmNoteRegister;

                    case "TRANSACTION":
                        return isTransaction || isDebitCreditNote || isExplicitJournalVoucher;

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

            skipped: 0,

            failed: 0,

            percentage: 0,

            errors: [] as any[]

        };
        const affectedLedgerIds = new Set<string>();
        // Avoid reopening every already-imported row. The source row is part
        // of the import identity for this workbook, so an exact source-row
        // match is safe to skip and also protects against duplicate vouchers
        // when an error report is retried.
        const existingSourceRows = await prisma.journal.findMany({
            where: {
                sourceSheet: { in: [...new Set(data.map(dto => dto.sourceSheet).filter(Boolean) as string[])] }
            },
            select: { sourceSheet: true, sourceRow: true, voucherNo: true }
        });
        const existingKeys = new Set(
            existingSourceRows.map(row => `${row.sourceSheet || ""}|${row.sourceRow}|${String(row.voucherNo || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()}`)
        );
        const rowsToProcess = data.filter(dto =>
            !existingKeys.has(`${dto.sourceSheet || ""}|${dto.sourceRow}|${String(dto.voucherNo || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()}`)
        );
        summary.skipped = data.length - rowsToProcess.length;
        summary.processed = summary.skipped;
        await Promise.all(

            rowsToProcess.map(dto =>

                limit(async () => {

                    let rowSkipped = false;

                    try {

                       const voucherType =
                            (dto.voucherType ?? "")
                                .trim()
                                .toUpperCase()
                                .replace(/_/g, " ");

                        const isCancelled =
                            ImportResolver.isCancelledTransactionImportRow(dto);
                        const isInvoiceTransaction =
                            ["PURCHASE", "TAX INVOICE", ...SPECIAL_PURCHASE_TYPES].includes(voucherType);
                        const isDebitCreditNote =
                            ImportResolver.isDebitCreditNoteImportRow(dto);

                        const isRcmNoteRegister =
                            ["RCM DEBIT NOTE", "RCM CREDIT NOTE"].includes(voucherType);

                        const isExplicitJournalVoucher =
                            ["CASH PAYMENT", "CASH RECEIPT", "BANK PAYMENT", "BANK RECEIPT", "RECEIPT", "PAYMENT", "OPENING BALANCE"].includes(voucherType);

                        const isInwardNote = ImportResolver.isInwardDebitCreditNoteImportRow(dto);

                        // -----------------------------
                        // Journal Import
                        // -----------------------------
                        if (
                            (type === "TRANSACTION" || type === "BOTH") &&
                            isInwardNote
                            && !isRcmNoteRegister
                        ) {
                            // The regular Journal Import UI posts here. Give
                            // inward notes the same Excel Path handling as
                            // the dedicated inward-note endpoint so the
                            // categoryPath is persisted and the Purchase
                            // ledger mapping is repaired when needed.
                            const result = await ImportResolver.importInwardPurchaseNote(
                                actor,
                                dto,
                                { resolvePath: true }
                            );
                            rowSkipped = (result as any)?.__importStatus === "skipped";
                        } else if (
                            (
                            (
                                type === "JOURNAL" ||
                                type === "BOTH" ||
                            (type === "TRANSACTION" && (isDebitCreditNote || isExplicitJournalVoucher))
                            ) &&
                            !isInvoiceTransaction &&
                            !isCancelled
                            )
                        ) {
                            if (ImportResolver.isJournalRegisterRow(dto)) {
                                const result = await ImportResolver.importJournalRegisterRow(
                                    actor,
                                    dto,
                                    { skipBalanceSync: true }
                                );
                                if ((result as any)?.ledgerId) {
                                    affectedLedgerIds.add((result as any).ledgerId);
                                }
                                rowSkipped = (result as any)?.__importStatus === "skipped";
                            } else {
                                const payload = await ImportResolver.buildJournalPayload(actor, dto);
                                const journal = await JournalService.createJournal(actor, payload);
                                await JournalService.approveJournal(actor, journal.id);
                            }

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

                        if (rowSkipped) summary.skipped++;
                        else summary.success++;

                    }

                    catch (error: any) {

                        const errorMessage = String(error?.message || error || "Unknown import error");
                        if (errorMessage === "SKIP_ALREADY_IMPORTED") {
                            summary.skipped++;
                            rowSkipped = true;
                        } else {
                            summary.failed++;
                        }

                        if (!rowSkipped) summary.errors.push({

                            sourceSerialNo:
                                dto.sourceSerialNo,

                            voucherNo:
                                dto.voucherNo,

                            accountName:
                                dto.accountName,

                            sourceSheet:
                                dto.sourceSheet,

                            sourceRow:
                                dto.sourceRow,

                            invoiceNo:
                                dto.invoiceNo,

                            voucherType:
                                dto.voucherType,

                            error: errorMessage,

                            meta:
                                dto.raw

                        });

                        if (!rowSkipped && summary.errors.length <= 20) {
                            console.error("[journal-import] row failed", {
                                sourceSerialNo: dto.sourceSerialNo,
                                voucherNo: dto.voucherNo,
                                accountName: dto.accountName,
                                sourceSheet: dto.sourceSheet,
                                sourceRow: dto.sourceRow,
                                voucherType: dto.voucherType,
                                error: error?.stack || errorMessage
                            });
                        }

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

                        // Updating the SSE stream for every row makes the
                        // browser and server spend significant time rendering
                        // progress for large workbooks. Keep progress smooth
                        // without sending 28k individual events.
                        if (
                            summary.processed === summary.total ||
                            summary.processed % 25 === 0
                        ) {
                            onProgress?.(summary);
                        }

                    }

                })

            )

        );

        // Recalculate each affected ledger once after all rows are posted.
        // Doing this inside every row transaction repeatedly scanned the
        // same ledger entries and was the dominant import cost.
        const balanceLimit = pLimit(8);
        const balanceResults = await Promise.allSettled(
            [...affectedLedgerIds].map(ledgerId =>
                balanceLimit(() => LedgerService.syncCachedBalance(prisma, ledgerId))
            )
        );
        for (const result of balanceResults) {
            if (result.status === "rejected") {
                console.error("[journal-import] balance sync failed", result.reason);
            }
        }

        if (summary.errors.length > 0) {
            summary.errorReport =
                await createImportErrorReport(
                    sources,
                    summary.errors,
                    8,
                    `journal-${type.toLowerCase()}`
                );
        }

        return summary;

    }

}
