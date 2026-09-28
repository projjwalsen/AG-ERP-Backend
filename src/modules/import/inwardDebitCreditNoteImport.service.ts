import { Express } from "express";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";

/** Dedicated importer for inward debit/credit notes. */
export class InwardDebitCreditNoteImportService {
    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        onProgress?: (summary: any) => void
    ) {
        if (!actor?.id) throw new Error("Unauthorized");

        const workbook = ExcelImportService.readExcel(file.buffer);
        const rows = workbook.SheetNames.flatMap(sheetName => {
            const worksheet = ExcelImportService.getWorkSheet(workbook, sheetName);
            const headerRow = ExcelImportService.detectJournalHeaderRow(worksheet);
            return ExcelImportService.parseJournalRows(
                ExcelImportService.readRows(worksheet, { headerRow }),
                sheetName,
                headerRow
            );
        }).filter(dto => ImportResolver.isInwardDebitCreditNoteImportRow(dto));

        const summary = {
            total: rows.length,
            processed: 0,
            success: 0,
            failed: 0,
            percentage: 0,
            errors: [] as any[]
        };

        for (const dto of rows) {
            try {
                await ImportResolver.importInwardPurchaseNote(actor, dto, { resolvePath: true });
                summary.success++;
            } catch (error: any) {
                summary.failed++;
                summary.errors.push({
                    sourceRow: dto.sourceRow,
                    voucherNo: dto.voucherNo,
                    particulars: dto.particulars,
                    path: dto.path,
                    message: error?.message || "Import failed"
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
