import fs from "fs";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";

const file = process.argv[2];
const execute = process.argv.includes("--execute");
const normalize = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const amount = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

async function main() {
    if (!file) throw new Error("Workbook path is required");
    const workbook = ExcelImportService.readExcel(fs.readFileSync(file));
    const sheet = ExcelImportService.getWorkSheet(workbook);
    const rows = ExcelImportService.readRows(sheet, { headerRow: 8 });
    const imported = ExcelImportService.parseJournalRows(rows).filter(row =>
        ["BANK PAYMENT", "BANK RECEIPT", "BANK_PAYMENT", "BANK_RECEIPT"].includes(normalize(row.voucherType))
    );
    const vouchers = await prisma.voucher.findMany({
        where: { voucherType: { in: [VoucherType.BANK_PAYMENT, VoucherType.BANK_RECEIPT] } },
        include: { entries: true }
    });
    const duplicateIds = new Set<string>();
    for (const row of imported) {
        const type = normalize(row.voucherType).replace(/_/g, " ");
        const candidates = vouchers.filter(v =>
            normalize(v.voucherType).replace(/_/g, " ") === type &&
            normalize(v.voucherNo) === normalize(row.voucherNo) &&
            normalize(v.narration) === normalize(row.particulars) &&
            sameDay(v.voucherDate, new Date(row.date)) &&
            Math.abs(v.entries.reduce((s, e) => s + Number(e.amount), 0) / 2 - Math.max(amount(row.debitAmount), amount(row.creditAmount))) < 0.01
        );
        candidates.slice(1).forEach(v => duplicateIds.add(v.id));
    }
    const duplicates = vouchers.filter(v => duplicateIds.has(v.id));
    if (execute) {
        await prisma.$transaction(async tx => {
            for (const voucher of duplicates) {
                await tx.ledgerEntry.deleteMany({ where: { voucherId: voucher.id } });
                await tx.voucher.delete({ where: { id: voucher.id } });
            }
        });
    }
    console.log(JSON.stringify({ workbookRows: imported.length, duplicates: duplicates.length, deleted: execute ? duplicates.length : 0, dryRun: !execute }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
