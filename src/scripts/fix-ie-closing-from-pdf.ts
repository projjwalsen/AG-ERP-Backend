import "dotenv/config";
import { BranchAccessType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { ImportResolver } from "../modules/import/import.resolver";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");

const DELETE_DUPES = [
    { journalId: "3d9f78de-d209-4f82-85ad-6d8468960836", voucherId: "855d1ebf-8d73-4451-a3f5-7450d8476781", voucherNo: "17", account: "Vanishka Anil Menda Salary", amount: 350000 },
    { journalId: "7c2d86cb-f85d-4756-baf6-4d8c1cfc2e97", voucherId: "d5237185-5ea4-4e37-ab5a-5ce12e53a073", voucherNo: "53", account: "Anil Menda Salary", amount: 150000 },
    { journalId: "6e73c285-c576-499a-9f76-112d4623d810", voucherId: "1fe0609d-ee97-49dd-9fc5-118e6e3a5198", voucherNo: "38", account: "Vanishka Anil Menda Salary", amount: 100000 }
];

const CREATE_FROM_PDF = [
    { voucherNo: "TH-F-SO3411", account: "Ineligible ITC 17(5) -CGST", amount: 366.12, date: "19-6-2025", type: "Journal" },
    { voucherNo: "IS25/210", account: "Ineligible ITC 17(5) -CGST", amount: 180, date: "21-8-2025", type: "Journal" }
];

async function main() {
    const inspected = [];
    for (const row of DELETE_DUPES) {
        const voucher = await prisma.voucher.findUnique({
            where: { id: row.voucherId },
            select: {
                id: true,
                voucherNo: true,
                journals: { select: { id: true, sourceSheet: true, journalHead: { select: { name: true } } } },
                transaction: { select: { id: true }, take: 1 },
                debitCreditNotes: { select: { id: true }, take: 1 },
                manufactures: { select: { id: true }, take: 1 },
                entries: { select: { id: true, ledgerId: true, amount: true, entryType: true } }
            }
        });
        inspected.push({
            ...row,
            safe: Boolean(
                voucher &&
                voucher.journals.length === 1 &&
                voucher.journals[0].id === row.journalId &&
                voucher.journals[0].sourceSheet === "Indirect Expenses PDF" &&
                voucher.transaction.length === 0 &&
                voucher.debitCreditNotes.length === 0 &&
                voucher.manufactures.length === 0 &&
                voucher.entries.length === 1
            ),
            sourceSheet: voucher?.journals[0]?.sourceSheet,
            head: voucher?.journals[0]?.journalHead?.name,
            entryCount: voucher?.entries.length,
            hasTxn: (voucher?.transaction.length || 0) > 0
        });
    }
    console.log(JSON.stringify({ dryRun: !apply, deleteDupes: inspected, create: CREATE_FROM_PDF }, null, 2));
    if (!apply) return;
    if (inspected.some(row => !row.safe)) throw new Error("Refusing to delete a voucher that is not a safe PDF duplicate");

    const affectedLedgerIds = new Set<string>();
    for (const row of DELETE_DUPES) {
        const voucher = await prisma.voucher.findUnique({
            where: { id: row.voucherId },
            select: { entries: { select: { ledgerId: true } } }
        });
        for (const entry of voucher?.entries || []) affectedLedgerIds.add(entry.ledgerId);
        await prisma.journal.delete({ where: { id: row.journalId } });
        await prisma.voucher.delete({ where: { id: row.voucherId } });
    }

    const user = await prisma.user.findFirst({ where: { email: "admin@ashtavinayaka.com" }, select: { id: true, branchId: true } });
    const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!user || !branch) throw new Error("Admin or branch missing");
    const actor = { id: user.id, branchId: user.branchId || branch.id, branchAccessType: BranchAccessType.ALL };
    const created = [];
    for (const [index, row] of CREATE_FROM_PDF.entries()) {
        try {
            const result = await ImportResolver.importJournalRegisterRow(actor, {
                date: ExcelImportService.toDate(row.date)!,
                sourceSerialNo: `IE-PDF-ITC-${row.voucherNo}-${index}`,
                importIndex: 9100 + index,
                sourceSheet: "Indirect Expenses PDF",
                sourceRow: 9100 + index,
                journalGroup: "Indirect Expenses",
                subGroup: "Rates and Taxes",
                accountName: row.account,
                narration: `Created from Tally Indirect Expenses PDF ${row.voucherNo}`,
                voucherNo: row.voucherNo,
                voucherType: row.type,
                particulars: row.account,
                debitAmount: row.amount,
                creditAmount: 0
            });
            created.push({
                voucherNo: row.voucherNo,
                account: row.account,
                amount: row.amount,
                status: (result as any).__importStatus || "created",
                ledgerId: (result as any).ledgerId
            });
            if ((result as any).ledgerId) affectedLedgerIds.add((result as any).ledgerId);
        } catch (error) {
            created.push({
                voucherNo: row.voucherNo,
                account: row.account,
                amount: row.amount,
                status: "error",
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
    console.log(JSON.stringify({ deleted: DELETE_DUPES.length, created }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
