import { Express } from "express";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import { DebitCreditNoteService } from "../debitCreditNote/debitCreditNote.service";
import { JournalImportService } from "./journalImport.service";

/** Dedicated note-only importer for inward and outward debit/credit notes. */
export class InwardDebitCreditNoteImportService {
    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        onProgress?: (summary: any) => void
    ) {
        if (!actor?.id) throw new Error("Unauthorized");

        console.log("[inward-note-import] reading workbook");
        const workbook = ExcelImportService.readExcel(file.buffer);
        console.log(`[inward-note-import] workbook sheets: ${workbook.SheetNames.join(", ")}`);
        const rows = workbook.SheetNames.flatMap(sheetName => {
            const worksheet = ExcelImportService.getWorkSheet(workbook, sheetName);
            const headerRow = ExcelImportService.detectJournalHeaderRow(worksheet);
            return ExcelImportService.parseJournalRows(
                ExcelImportService.readRows(worksheet, { headerRow }),
                sheetName,
                headerRow
            );
        }).filter(dto => ImportResolver.isDebitCreditNoteImportRow(dto));
        console.log(`[inward-note-import] parsed matching rows: ${rows.length}`);

        // RCM Debit/Credit Note exports from Tally are journal-register
        // workbooks: one voucher is split across balanced debit/credit lines
        // and uses Path instead of a ledger column. They cannot be imported
        // as one-note-per-row documents because the dedicated note workflow
        // requires an approved Purchase record for every row. Preserve the
        // source accounting lines through the Journal importer instead.
        const isRcmRegister = rows.length > 0 && rows.every(dto =>
            ["RCM DEBIT NOTE", "RCM CREDIT NOTE"].includes(
                String(dto.voucherType || "")
                    .replace(/_/g, " ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase()
            )
        );
        if (isRcmRegister) {
            return JournalImportService.importWorkbook(
                actor,
                file,
                "JOURNAL",
                undefined,
                undefined,
                onProgress
            );
        }

        const summary = {
            total: rows.length,
            processed: 0,
            success: 0,
            skipped: 0,
            failed: 0,
            percentage: 0,
            errors: [] as any[]
        };

        for (const dto of rows) {
            try {
                console.log(
                    `[inward-note-import] processing row=${dto.sourceRow ?? "?"}` +
                    ` voucher=${dto.voucherNo ?? ""}`
                );
                const normalizedVoucherType = String(dto.voucherType || "")
                    .replace(/_/g, " ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase();

                /*
                 * RCM note registers are journal exports, not the normal
                 * one-row DebitCreditNote document format. A single RCM note
                 * number may have several rows (expense, creditor, TDS,
                 * etc.), so importing each row as a DebitCreditNote would
                 * repeatedly update the same note and lose the other ledger
                 * lines. Keep the row-side Path/account mapping and post each
                 * register row as a journal-backed ledger entry instead.
                 */
                if (["RCM DEBIT NOTE", "RCM CREDIT NOTE"].includes(normalizedVoucherType)) {
                    await ImportResolver.importJournalRegisterRow(actor, dto);
                } else {
                    const result = await ImportResolver.importDebitCreditNoteOnly(actor, dto);
                    console.log(
                        `[inward-note-import] resolved voucher=${dto.voucherNo ?? ""}` +
                        ` skipped=${result.skipped}`
                    );
                    if (result.skipped) {
                        summary.skipped++;
                    } else {
                        if (result.note.status === "PENDING" && result.note.agencyId) {
                            await DebitCreditNoteService.approveNote(actor, result.note.id);
                        }
                        summary.success++;
                    }
                }
                if (normalizedVoucherType.startsWith("RCM ")) {
                    summary.success++;
                }
            } catch (error: any) {
                summary.failed++;
                summary.errors.push({
                    sourceRow: dto.sourceRow,
                    voucherNo: dto.voucherNo,
                    particulars: dto.particulars,
                    path: dto.path,
                    message: error?.message || "Import failed",
                    voucherType: dto.voucherType
                });
            } finally {
                summary.processed++;
                summary.percentage = Number(((summary.processed / Math.max(summary.total, 1)) * 100).toFixed(2));
                onProgress?.(summary);
            }
        }

        return summary;
    }
}
