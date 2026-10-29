import "dotenv/config";
import { BranchAccessType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { ImportResolver } from "../modules/import/import.resolver";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");

async function main() {
    console.log(JSON.stringify({ dryRun: !apply, create: { account: "MOBILE & TELEPHONE EXPENSES", amount: 946.98 } }, null, 2));
    if (!apply) return;
    const user = await prisma.user.findFirst({ where: { email: "admin@ashtavinayaka.com" } });
    const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    if (!user || !branch) throw new Error("admin/branch missing");
    const result = await ImportResolver.importJournalRegisterRow(
        { id: user.id, branchId: user.branchId || branch.id, branchAccessType: BranchAccessType.ALL },
        {
            date: ExcelImportService.toDate("31-3-2026")!,
            sourceSerialNo: "IE-PDF-TALLY-MOBILE-946",
            importIndex: 9311,
            sourceSheet: "Indirect Expenses PDF",
            sourceRow: 9311,
            journalGroup: "Indirect Expenses",
            accountName: "MOBILE & TELEPHONE EXPENSES",
            narration: "Restore Tally MOBILE & TELEPHONE EXPENSES 38,604.80 after IE closing residual",
            voucherNo: "IE-PDF-TALLY-MOBILE",
            voucherType: "Journal",
            particulars: "MOBILE & TELEPHONE EXPENSES",
            debitAmount: 946.98,
            creditAmount: 0
        }
    );
    if ((result as any).ledgerId) await LedgerService.syncCachedBalance(prisma, (result as any).ledgerId);
    console.log(JSON.stringify({ status: (result as any).__importStatus || "created", ledgerId: (result as any).ledgerId }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
