import fs from "fs";
import { EntryType, LedgerType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";

const file = process.argv[2];
const execute = process.argv.includes("--execute");
const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

async function main() {
    if (!file) throw new Error("Workbook path is required");
    const workbook = ExcelImportService.readExcel(fs.readFileSync(file));
    const rows = ExcelImportService.readRows(ExcelImportService.getWorkSheet(workbook), { headerRow: 8 });
    const sourceRows = ExcelImportService.parseJournalRows(rows).filter(r => num(r.debitAmount) > 0);
    const banks = await prisma.ledger.findMany({ where: { category: LedgerType.BANK, isActive: true }, select: { id: true } });
    const bankIds = new Set(banks.map(b => b.id));
    const vouchers = await prisma.voucher.findMany({ include: { entries: true } });
    const repairs: Array<{ keep: string; entry: string; amount: number; remove: string[] }> = [];
    for (const row of sourceRows) {
        const amount = num(row.debitAmount);
        const matches = vouchers.filter(v => sameDay(v.voucherDate, new Date(row.date)) && norm(v.narration) === norm(row.particulars) && Math.abs(v.entries.reduce((s, e) => s + Number(e.amount), 0) / 2 - amount) < 0.01);
        if (!matches.length) continue;
        const chosen = matches[0];
        const entry = chosen.entries.find(e => bankIds.has(e.ledgerId)) || chosen.entries[0];
        if (entry) repairs.push({ keep: chosen.id, entry: entry.id, amount, remove: matches.slice(1).map(v => v.id) });
    }
    const remove = [...new Set(repairs.flatMap(r => r.remove))];
    if (execute) await prisma.$transaction(async tx => {
        for (const r of repairs) { await tx.ledgerEntry.update({ where: { id: r.entry }, data: { entryType: EntryType.DEBIT, amount: r.amount } }); await tx.voucher.update({ where: { id: r.keep }, data: { voucherType: VoucherType.BANK_RECEIPT } }); }
        for (const id of remove) { await tx.ledgerEntry.deleteMany({ where: { voucherId: id } }); await tx.voucher.delete({ where: { id } }); }
    });
    console.log(JSON.stringify({ workbookRows: sourceRows.length, matched: repairs.length, duplicates: remove.length, repaired: execute ? repairs.length : 0, deleted: execute ? remove.length : 0, dryRun: !execute }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
