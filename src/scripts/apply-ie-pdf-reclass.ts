import "dotenv/config";
import {
    BranchAccessType,
    EntryType,
    JournalStatus,
    PaymentMode,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { ImportResolver } from "../modules/import/import.resolver";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");
const n = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

async function ledgerByName(name: string, pathIncludes?: string) {
    const rows = await prisma.ledger.findMany({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true, name: true, group: { select: { name: true, parent: { select: { name: true } } } } }
    });
    const match = pathIncludes
        ? rows.find(row => n(`${row.group?.parent?.name || ""} ${row.group?.name || ""}`).toLowerCase().includes(pathIncludes.toLowerCase()))
        : rows[0];
    if (!match) throw new Error(`Ledger not found: ${name}`);
    return match;
}

async function journalHeadForLedger(ledgerId: string, name: string) {
    const existing = await prisma.journalHead.findFirst({
        where: { ledgerId, name: { equals: name, mode: "insensitive" } }
    });
    if (existing) return existing;
    return prisma.journalHead.create({
        data: { name, ledgerId, isActive: true }
    });
}

async function main() {
    const factory = await ledgerByName("FACTORY INSURANCE", "insurance");
    const prepaidIns = await ledgerByName("Prepaid Insurance");
    const internet = await ledgerByName("Internet Charges");
    const prepaidExp = await ledgerByName("Prepaid Expenses");
    const factoryHead = await journalHeadForLedger(factory.id, "FACTORY INSURANCE");
    const internetHead = await journalHeadForLedger(internet.id, "Internet Charges");
    const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    const actor = await prisma.user.findFirst({ where: { email: "admin@ashtavinayaka.com" } });
    if (!branch || !actor) throw new Error("branch/admin missing");

    const reclass = [
        {
            voucherNo: "IE-PDF-17020025E0005779",
            date: "17-10-2025",
            amount: 326009.70,
            debit: factory,
            credit: prepaidIns,
            head: factoryHead,
            remarks: "Reclass Tally IE PDF factory insurance 17020025E0005779 from Prepaid Insurance"
        },
        {
            voucherNo: "IE-PDF-250927MH00049306",
            date: "27-9-2025",
            amount: 14071.51,
            debit: internet,
            credit: prepaidExp,
            head: internetHead,
            remarks: "Reclass Tally IE PDF internet 250927MH00049306 from Prepaid Expenses"
        }
    ];
    console.log(JSON.stringify({
        dryRun: !apply,
        factory: factory.name,
        prepaidIns: prepaidIns.name,
        internet: internet.name,
        prepaidExp: prepaidExp.name,
        reclass: reclass.map(row => ({
            voucherNo: row.voucherNo,
            amount: row.amount,
            debit: row.debit.name,
            credit: row.credit.name
        })),
        courier: { voucherNo: "2254226776", amount: 1450, account: "Courier Charges" }
    }, null, 2));
    if (!apply) return;

    for (const row of reclass) {
        const existing = await prisma.journal.findUnique({ where: { importKey: `IE-PDF-RECLASS-${row.voucherNo}` } });
        if (existing) continue;
        const journalDate = ExcelImportService.toDate(row.date)!;
        const journal = await prisma.journal.create({
            data: {
                branchId: branch.id,
                journalHeadId: row.head.id,
                importKey: `IE-PDF-RECLASS-${row.voucherNo}`,
                voucherNo: row.voucherNo,
                sourceSheet: "Indirect Expenses PDF",
                amount: row.amount,
                paymentMode: PaymentMode.OFFLINE,
                remarks: row.remarks,
                journalDate,
                status: JournalStatus.PENDING,
                createdById: actor.id
            }
        });
        const voucher = await prisma.voucher.create({
            data: {
                voucherNo: row.voucherNo,
                voucherType: VoucherType.JOURNAL,
                sourceId: journal.id,
                branchId: branch.id,
                narration: row.remarks,
                totalDebit: row.amount,
                totalCredit: row.amount,
                voucherDate: journalDate,
                entries: {
                    create: [
                        { ledgerId: row.debit.id, branchId: branch.id, entryType: EntryType.DEBIT, amount: row.amount, narration: row.remarks },
                        { ledgerId: row.credit.id, branchId: branch.id, entryType: EntryType.CREDIT, amount: row.amount, narration: row.remarks }
                    ]
                }
            }
        });
        await prisma.journal.update({
            where: { id: journal.id },
            data: {
                status: JournalStatus.APPROVED,
                approvedById: actor.id,
                approvedAt: new Date(),
                voucherId: voucher.id
            }
        });
        await LedgerService.syncCachedBalance(prisma, row.debit.id);
        await LedgerService.syncCachedBalance(prisma, row.credit.id);
    }

    const courier = await ImportResolver.importJournalRegisterRow(
        { id: actor.id, branchId: actor.branchId || branch.id, branchAccessType: BranchAccessType.ALL },
        {
            date: ExcelImportService.toDate("1-7-2025")!,
            sourceSerialNo: "IE-PDF-COURIER-2254226776",
            importIndex: 9201,
            sourceSheet: "Indirect Expenses PDF",
            sourceRow: 9201,
            journalGroup: "Indirect Expenses",
            accountName: "Courier Charges",
            narration: "Created from Tally Indirect Expenses PDF 2254226776",
            voucherNo: "2254226776",
            voucherType: "Journal",
            particulars: "Courier Charges",
            debitAmount: 1450,
            creditAmount: 0
        }
    );
    if ((courier as any).ledgerId) await LedgerService.syncCachedBalance(prisma, (courier as any).ledgerId);
    console.log(JSON.stringify({
        reclassed: reclass.map(row => row.voucherNo),
        courier: { status: (courier as any).__importStatus || "created", ledgerId: (courier as any).ledgerId }
    }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
