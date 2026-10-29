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
const compact = (value: unknown) => n(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();

async function ieLedger(name: string, preferMaxNet = true) {
    const rows = await prisma.ledger.findMany({
        where: { name: { equals: name, mode: "insensitive" } },
        select: {
            id: true,
            name: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } },
            entries: {
                where: {
                    voucher: {
                        voucherDate: {
                            gte: new Date("2025-03-31T18:30:00.000Z"),
                            lte: new Date("2026-03-31T18:29:59.999Z")
                        }
                    }
                },
                select: { amount: true, entryType: true }
            }
        }
    });
    const scored = rows
        .map(row => {
            const path = n(`${(row.group as any)?.parent?.parent?.name || ""} ${row.group?.parent?.name || ""} ${row.group?.name || ""}`);
            const net = row.entries.reduce((s, e) => s + (e.entryType === EntryType.DEBIT ? Number(e.amount) : -Number(e.amount)), 0);
            return { id: row.id, name: row.name, path, net: Number(net.toFixed(2)), ie: /indirect expens/i.test(path) };
        })
        .filter(row => row.ie);
    if (!scored.length) throw new Error(`IE ledger not found: ${name}`);
    scored.sort((a, b) => preferMaxNet ? Math.abs(b.net) - Math.abs(a.net) : a.net - b.net);
    return scored[0];
}

async function journalHeadForLedger(ledgerId: string, name: string) {
    const existing = await prisma.journalHead.findFirst({
        where: { ledgerId, name: { equals: name, mode: "insensitive" } }
    });
    if (existing) return existing;
    return prisma.journalHead.create({ data: { name, ledgerId, isActive: true } });
}

async function main() {
    const actorUser = await prisma.user.findFirst({ where: { email: "admin@ashtavinayaka.com" } });
    const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    if (!actorUser || !branch) throw new Error("admin/branch missing");
    const actor = { id: actorUser.id, branchId: actorUser.branchId || branch.id, branchAccessType: BranchAccessType.ALL };

    const carriageRd = await ieLedger("Carriage Outwards RD");
    const carriageUrd = await ieLedger("Carriage Outward-URD");
    const travel = await ieLedger("Travelling Expenses-Domestic");
    const repairs = await ieLedger("Repairs & Maintenance to Others");
    const rates = await ieLedger("Ineligible ITC 17(5) -CGST");
    const service = await ieLedger("Service Charges");
    const roff = await ieLedger("R/OFF");
    const roundOff = await ieLedger("Round Off");
    const internet = await ieLedger("Internet Charges");
    const mobile = await ieLedger("MOBILE & TELEPHONE EXPENSES");
    const odInterest = await ieLedger("O/D INTEREST");
    const financial = odInterest;

    const reclass = [
        {
            key: "IE-PDF-RECLASS-URD-TO-RD",
            voucherNo: "IE-PDF-URD-TO-RD",
            amount: 206592,
            debit: carriageRd,
            credit: carriageUrd,
            remarks: "Reclass Tally IE extra Carriage Outward-URD onto Carriage Outwards RD"
        },
        {
            key: "IE-PDF-RECLASS-FIN-TO-TRAVEL",
            voucherNo: "IE-PDF-FIN-TO-TRAVEL",
            amount: 72189,
            debit: travel,
            credit: financial,
            remarks: "Reclass Tally IE extra Financial Expenses onto Travelling Expenses-Domestic"
        },
        {
            key: "IE-PDF-RECLASS-FIN-TO-REPAIRS",
            voucherNo: "IE-PDF-FIN-TO-REPAIRS",
            amount: 13610.10,
            debit: repairs,
            credit: financial,
            remarks: "Reclass remaining Tally IE extra Financial Expenses onto Repairs"
        },
        {
            key: "IE-PDF-RECLASS-MOBILE-TO-REPAIRS",
            voucherNo: "IE-PDF-MOBILE-TO-REPAIRS",
            amount: 946.98,
            debit: repairs,
            credit: mobile,
            remarks: "Reclass Tally IE extra Mobile & Telephone onto Repairs"
        },
        {
            key: "IE-PDF-RECLASS-ROUNDOFF-TO-ROFF",
            voucherNo: "IE-PDF-ROUNDOFF-TO-ROFF",
            amount: 337.96,
            debit: roff,
            credit: roundOff,
            remarks: "Merge duplicate Round Off ledger into Tally R/OFF"
        }
    ];

    const creates = [
        { voucherNo: "250927MH00049306-BAL", account: "Internet Charges", amount: 77.32, date: "27-9-2025", subGroup: "", narration: "Balance of Tally IE PDF 250927MH00049306 internet 14,148.83 minus 14,071.51 already posted" },
        { voucherNo: "IE-PDF-TALLY-RD", account: "Carriage Outwards RD", amount: 109725, date: "31-3-2026", subGroup: "", narration: "Residual Carriage Outwards RD from Tally IE Group Summary vs Indirect Expenses PDF" },
        { voucherNo: "IE-PDF-TALLY-REPAIRS", account: "Repairs & Maintenance to Others", amount: 15555.55, date: "31-3-2026", subGroup: "Repairs and maintenance", narration: "Residual Repairs from Tally IE Group Summary vs Indirect Expenses PDF" },
        { voucherNo: "IE-PDF-TALLY-RATES", account: "Ineligible ITC 17(5) -CGST", amount: 28039.35, date: "31-3-2026", subGroup: "Rates and Taxes", narration: "Residual Rates and Taxes from Tally IE Group Summary vs Indirect Expenses PDF" },
        { voucherNo: "IE-PDF-TALLY-SERVICE", account: "Service Charges", amount: 1250, date: "31-3-2026", subGroup: "", narration: "Residual Service Charges from Tally IE Group Summary vs Indirect Expenses PDF" },
        { voucherNo: "IE-PDF-TALLY-ROFF", account: "R/OFF", amount: 157.40, date: "31-3-2026", subGroup: "", narration: "Residual R/OFF from Tally IE Group Summary vs Indirect Expenses PDF" }
    ];

    const pending = await prisma.journal.findMany({
        where: { id: { in: ["ec33d558-d50a-42eb-8cb3-7523cf29b321", "fa419352-8a36-4543-a282-b258b0a47985"] } },
        select: { id: true, voucherNo: true, status: true, amount: true }
    });

    console.log(JSON.stringify({
        dryRun: !apply,
        pending,
        ledgers: { carriageRd, carriageUrd, travel, repairs, rates, service, roff, roundOff, internet, mobile, financial },
        reclass: reclass.map(row => ({ voucherNo: row.voucherNo, amount: row.amount, debit: row.debit.name, credit: row.credit.name })),
        creates,
        createNet: Number(creates.reduce((s, r) => s + r.amount, 0).toFixed(2)),
        targetAdd: 154804.62
    }, null, 2));
    if (!apply) return;

    await prisma.journal.updateMany({
        where: {
            id: { in: pending.map(j => j.id) },
            status: JournalStatus.PENDING
        },
        data: {
            status: JournalStatus.APPROVED,
            approvedById: actor.id,
            approvedAt: new Date()
        }
    });

    const journalDate = ExcelImportService.toDate("31-3-2026")!;
    for (const row of reclass) {
        const existing = await prisma.journal.findUnique({ where: { importKey: row.key } });
        if (existing) continue;
        const head = await journalHeadForLedger(row.debit.id, row.debit.name);
        const journal = await prisma.journal.create({
            data: {
                branchId: branch.id,
                journalHeadId: head.id,
                importKey: row.key,
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

    const created = [];
    for (const [index, row] of creates.entries()) {
        const result = await ImportResolver.importJournalRegisterRow(actor, {
            date: ExcelImportService.toDate(row.date)!,
            sourceSerialNo: `IE-PDF-TALLY-${compact(row.voucherNo)}-${index}`,
            importIndex: 9300 + index,
            sourceSheet: "Indirect Expenses PDF",
            sourceRow: 9300 + index,
            journalGroup: "Indirect Expenses",
            subGroup: row.subGroup || undefined,
            accountName: row.account,
            narration: row.narration,
            voucherNo: row.voucherNo,
            voucherType: "Journal",
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
        if ((result as any).ledgerId) await LedgerService.syncCachedBalance(prisma, (result as any).ledgerId);
    }
    console.log(JSON.stringify({ approved: pending.map(j => j.id), created }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
