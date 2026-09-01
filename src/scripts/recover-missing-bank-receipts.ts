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
    const banks = await prisma.ledger.findMany({ where: { category: LedgerType.BANK, isActive: true }, select: { id: true, name: true } });
    if (!banks.length) throw new Error("No active bank ledger found");
    const bank = banks[0];
    const journals = await prisma.journal.findMany({ where: { voucherId: null }, include: { journalHead: true } });
    const vouchers = await prisma.voucher.findMany({ include: { entries: true } });
    const recoveries: Array<{ journalId: string; headLedgerId: string; amount: number; branchId: string; voucherDate: Date; voucherNo: string }> = [];
    let alreadyPresent = 0;
    let unmatched = 0;
    let ambiguous = 0;
    for (const row of sourceRows) {
        const amount = num(row.debitAmount);
        const existing = vouchers.filter(v => sameDay(v.voucherDate, new Date(row.date)) && norm(v.narration) === norm(row.particulars) && v.entries.some(e => e.ledgerId === bank.id && e.entryType === EntryType.DEBIT && Math.abs(Number(e.amount) - amount) < 0.01));
        if (existing.length) { alreadyPresent++; continue; }
        const matches = journals.filter(j => sameDay(j.journalDate, new Date(row.date)) && norm(j.remarks) === norm(row.particulars) && Math.abs(Number(j.amount) - amount) < 0.01);
        if (matches.length !== 1 || !matches[0].journalHead) { matches.length > 1 ? ambiguous++ : unmatched++; continue; }
        const journal = matches[0];
        recoveries.push({ journalId: journal.id, headLedgerId: journal.journalHead.ledgerId, amount, branchId: journal.branchId, voucherDate: journal.journalDate, voucherNo: `BRCT-RECOVER-${journal.id.slice(0, 8)}` });
    }
    if (execute) await prisma.$transaction(async tx => {
        for (const r of recoveries) {
            const voucher = await tx.voucher.create({ data: { voucherNo: r.voucherNo, voucherType: VoucherType.BANK_RECEIPT, sourceId: r.journalId, branchId: r.branchId, narration: "Recovered bank receipt", voucherDate: r.voucherDate, entries: { create: [{ ledgerId: bank.id, entryType: EntryType.DEBIT, amount: r.amount }, { ledgerId: r.headLedgerId, entryType: EntryType.CREDIT, amount: r.amount }] } } });
            await tx.journal.update({ where: { id: r.journalId }, data: { voucherId: voucher.id } });
        }
    });
    console.log(JSON.stringify({ workbookRows: sourceRows.length, alreadyPresent, recoverable: recoveries.length, unmatched, ambiguous, recovered: execute ? recoveries.length : 0, dryRun: !execute }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
