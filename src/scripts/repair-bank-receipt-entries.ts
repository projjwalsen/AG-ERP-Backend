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
    const receipts = ExcelImportService.parseJournalRows(rows).filter(r => norm(r.voucherType).replace(/_/g, " ") === "BANK RECEIPT" && num(r.debitAmount) > 0);
    const banks = await prisma.ledger.findMany({ where: { category: LedgerType.BANK, isActive: true }, select: { id: true } });
    if (!banks.length) throw new Error("No active bank ledger found");
    const bankIds = new Set(banks.map(b => b.id));
    const journals = await prisma.journal.findMany({ include: { journalHead: true, voucher: { include: { entries: true } } } });
    const repairs: Array<{ journalId: string; entryId: string; amount: number; ledgerId?: string }> = [];
    for (const row of receipts) {
        const amount = num(row.debitAmount);
        const matches = journals.filter(j => j.voucher?.voucherType === VoucherType.BANK_RECEIPT && norm(j.voucher.voucherNo) === norm(row.voucherNo) && norm(j.voucher.narration) === norm(row.particulars) && sameDay(j.voucher.voucherDate, new Date(row.date)) && Math.abs(Number(j.amount) - amount) < 0.01);
        if (matches.length !== 1 || !matches[0].voucher) continue;
        const j = matches[0];
        const entry = j.voucher.entries.find(e => bankIds.has(e.ledgerId)) || j.voucher.entries.find(e => e.ledgerId !== j.journalHead.ledgerId);
        if (entry) repairs.push({ journalId: j.id, entryId: entry.id, amount, ledgerId: bankIds.has(entry.ledgerId) ? undefined : banks[0].id });
    }
    if (execute) await prisma.$transaction(async tx => { for (const r of repairs) { await tx.ledgerEntry.update({ where: { id: r.entryId }, data: { ledgerId: r.ledgerId, entryType: EntryType.DEBIT, amount: r.amount } }); await tx.journal.update({ where: { id: r.journalId }, data: { amount: r.amount } }); } });
    console.log(JSON.stringify({ workbookRows: receipts.length, matched: repairs.length, repaired: execute ? repairs.length : 0, dryRun: !execute }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
