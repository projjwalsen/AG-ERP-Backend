import fs from "fs";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";

const file = process.argv[2];
const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

async function main() {
    if (!file) throw new Error("Workbook path is required");
    const workbook = ExcelImportService.readExcel(fs.readFileSync(file));
    const rows = ExcelImportService.readRows(ExcelImportService.getWorkSheet(workbook), { headerRow: 8 });
    const sourceRows = ExcelImportService.parseJournalRows(rows).filter(r => num(r.debitAmount) > 0);
    const vouchers = await prisma.voucher.findMany({ include: { entries: { include: { ledger: true } } } });
    const result = sourceRows.map(row => {
        const debit = num(row.debitAmount);
        const candidates = vouchers.filter(v => sameDay(v.voucherDate, new Date(row.date)) && Math.abs(v.entries.reduce((s, e) => s + Number(e.amount), 0) / 2 - debit) < 0.01);
        const narrationMatches = candidates.filter(v => norm(v.narration) === norm(row.particulars));
        const matches = narrationMatches.length ? narrationMatches : candidates;
        return { voucherNo: row.voucherNo, date: row.date, particulars: row.particulars, debit, candidates: matches.map(v => ({ id: v.id, voucherNo: v.voucherNo, type: v.voucherType, narration: v.narration, ledgers: v.entries.map(e => ({ ledger: e.ledger.name, category: e.ledger.category, side: e.entryType, amount: e.amount })) })) };
    });
    console.log(JSON.stringify({ workbookRows: sourceRows.length, matched: result.filter(r => r.candidates.length === 1).length, unmatched: result.filter(r => r.candidates.length === 0).length, ambiguous: result.filter(r => r.candidates.length > 1).length, rows: result }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
