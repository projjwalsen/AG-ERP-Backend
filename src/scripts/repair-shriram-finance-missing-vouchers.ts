import "dotenv/config";
import {
    EntryType,
    JournalDirection,
    JournalStatus,
    LedgerNature,
    LedgerType,
    PaymentMode,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const BRANCH_CODE = "AG_ASHTAVINAYAKA_PETROCHEM-MH";
const LEDGER_NAME = "SHRIRAM FINANCE LIMITED";
const FY_START = new Date("2025-04-01T00:00:00+05:30");
const FY_END = new Date("2026-04-01T00:00:00+05:30");
const EXPECTED_SIDE_TOTAL = 91_704_572_00;
const EXPECTED_PRE_CREDIT = 79_035_371_00;

const MISSING = [
    { date: "2025-05-05", voucherNo: "334", row: 14, amount: 3_617_289_00, particulars: "Sulaki Chemicals Pvt Ltd-CR" },
    { date: "2025-05-05", voucherNo: "335", row: 16, amount: 114_391_00, particulars: "Interest on Unsecured Loan" },
    { date: "2025-05-06", voucherNo: "344", row: 20, amount: 4_995_683_00, particulars: "Sulaki Chemicals Pvt Ltd-CR" },
    { date: "2025-05-06", voucherNo: "345", row: 21, amount: 157_980_00, particulars: "Interest on Unsecured Loan" },
    { date: "2025-05-07", voucherNo: "358", row: 24, amount: 3_667_868_00, particulars: "Sulaki Chemicals Pvt Ltd-CR" },
    { date: "2025-05-07", voucherNo: "359", row: 25, amount: 115_990_00, particulars: "Interest on Unsecured Loan" }
] as const;

const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const asMoney = (value: number) => Number((value / 100).toFixed(2));
const istDate = (date: string) => new Date(`${date}T00:00:00+05:30`);
const apply = process.argv.includes("--apply");

async function main() {
    const result = await prisma.$transaction(async tx => {
        const branch = await tx.branch.findUnique({ where: { code: BRANCH_CODE } });
        if (!branch || !branch.isActive) throw new Error(`Active branch ${BRANCH_CODE} was not found`);

        const ledgers = await tx.ledger.findMany({
            where: {
                branchId: branch.id,
                category: LedgerType.JOURNAL,
                name: { equals: LEDGER_NAME, mode: "insensitive" }
            },
            include: { group: true }
        });
        if (ledgers.length !== 2 || ledgers.some(ledger => ledger.group.name !== "Unsecured Loans")) {
            throw new Error(`Expected the two known SHRIRAM FINANCE LIMITED ledgers under Unsecured Loans; found ${ledgers.length}`);
        }

        const ledgerIds = ledgers.map(ledger => ledger.id);
        const entries = await tx.ledgerEntry.findMany({
            where: {
                ledgerId: { in: ledgerIds },
                voucher: { voucherDate: { gte: FY_START, lt: FY_END } }
            },
            select: {
                ledgerId: true,
                entryType: true,
                amount: true,
                voucher: { select: { voucherType: true } }
            }
        });
        const opening = entries.filter(entry =>
            entry.voucher.voucherType === VoucherType.OPENING_BALANCE &&
            entry.entryType === EntryType.CREDIT &&
            cents(entry.amount) === 2_988_440_300
        );
        if (opening.length !== 1) throw new Error(`Expected one ₹29,884,403 opening credit; found ${opening.length}`);
        const target = ledgers.find(ledger => ledger.id === opening[0].ledgerId)!;

        const debitBefore = entries.filter(entry => entry.entryType === EntryType.DEBIT)
            .reduce((sum, entry) => sum + cents(entry.amount), 0);
        const creditBefore = entries.filter(entry => entry.entryType === EntryType.CREDIT)
            .reduce((sum, entry) => sum + cents(entry.amount), 0);
        if (debitBefore !== EXPECTED_SIDE_TOTAL || creditBefore !== EXPECTED_PRE_CREDIT) {
            throw new Error(
                `Pre-posting control failed: debit=${asMoney(debitBefore)}, credit=${asMoney(creditBefore)}; ` +
                `expected debit=${asMoney(EXPECTED_SIDE_TOTAL)}, credit=${asMoney(EXPECTED_PRE_CREDIT)}`
            );
        }

        const head = await tx.journalHead.findFirst({
            where: {
                ledgerId: target.id,
                name: { equals: LEDGER_NAME, mode: "insensitive" },
                headType: "SUBHEAD",
                parent: { name: { equals: "Unsecured Loans", mode: "insensitive" } }
            }
        });
        if (!head) throw new Error("The existing SHRIRAM FINANCE LIMITED / Unsecured Loans journal head was not found");
        const category = await tx.journalCategory.findFirst({
            where: { journalHeadId: head.id, name: { equals: LEDGER_NAME, mode: "insensitive" } }
        });
        if (!category) throw new Error("The existing SHRIRAM FINANCE LIMITED journal category was not found");

        const existingExpected = await tx.journal.findMany({
            where: { branchId: branch.id, journalHeadId: head.id, voucherNo: { in: MISSING.map(row => row.voucherNo) } },
            select: { voucherNo: true, amount: true, direction: true }
        });
        if (existingExpected.length) {
            throw new Error(`One or more target-head voucher numbers already exist: ${JSON.stringify(existingExpected)}`);
        }

        const serialNos = MISSING.map(row => `SHRI-RECON-2025-26-${row.voucherNo}`);
        const imports = MISSING.map(row => `SHRI_FINANCE_RECON_2025_26_${row.voucherNo}`);
        const serialCollisions = await tx.journal.findMany({
            where: { branchId: branch.id, OR: [{ serialNo: { in: serialNos } }, { importKey: { in: imports } }] },
            select: { serialNo: true, importKey: true, voucherNo: true }
        });
        if (serialCollisions.length) throw new Error(`Repair import keys already exist: ${JSON.stringify(serialCollisions)}`);

        const preview = MISSING.map(row => ({
            voucherNo: row.voucherNo,
            date: row.date,
            debit: 0,
            credit: asMoney(row.amount),
            particulars: row.particulars,
            sourceRow: row.row,
            action: apply ? "create approved imported journal row" : "would create approved imported journal row"
        }));
        if (!apply) return { dryRun: true, branch: branch.name, targetLedgerId: target.id, preview };

        const operator = await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE", branchId: branch.id },
            orderBy: { createdAt: "asc" },
            select: { id: true }
        }) ?? await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE", branchId: null },
            orderBy: { createdAt: "asc" },
            select: { id: true }
        });
        if (!operator) throw new Error("No active user is available for journal audit fields");

        const created = [];
        for (let index = 0; index < MISSING.length; index++) {
            const row = MISSING[index];
            const amount = asMoney(row.amount);
            const remarks = `Particulars: ${row.particulars} | Reconciled from SHRIRAM.xls row ${row.row}`;
            const journal = await tx.journal.create({
                data: {
                    branchId: branch.id,
                    journalHeadId: head.id,
                    categoryId: category.id,
                    serialNo: serialNos[index],
                    voucherNo: row.voucherNo,
                    sourceSheet: "SHRIRAM FINANCE LIMITED",
                    sourceRow: row.row,
                    importKey: imports[index],
                    amount,
                    direction: JournalDirection.INWARD,
                    paymentMode: PaymentMode.OFFLINE,
                    remarks,
                    journalDate: istDate(row.date),
                    status: JournalStatus.APPROVED,
                    createdById: operator.id,
                    approvedById: operator.id,
                    approvedAt: new Date()
                }
            });
            const voucher = await tx.voucher.create({
                data: {
                    voucherNo: row.voucherNo,
                    voucherType: VoucherType.JOURNAL,
                    sourceId: journal.id,
                    branchId: branch.id,
                    narration: remarks,
                    totalDebit: 0,
                    totalCredit: amount,
                    voucherDate: istDate(row.date),
                    entries: {
                        create: {
                            ledgerId: target.id,
                            branchId: branch.id,
                            entryType: EntryType.CREDIT,
                            amount,
                            narration: remarks
                        }
                    }
                },
                select: { id: true, voucherNo: true }
            });
            await tx.journal.update({ where: { id: journal.id }, data: { voucherId: voucher.id } });
            created.push({ journalId: journal.id, voucherId: voucher.id, voucherNo: row.voucherNo, amount });
        }

        await LedgerService.syncCachedBalance(tx, target.id);
        const after = await tx.ledgerEntry.findMany({
            where: {
                ledgerId: { in: ledgerIds },
                voucher: { voucherDate: { gte: FY_START, lt: FY_END } }
            },
            select: { entryType: true, amount: true }
        });
        const debitAfter = after.filter(entry => entry.entryType === EntryType.DEBIT)
            .reduce((sum, entry) => sum + cents(entry.amount), 0);
        const creditAfter = after.filter(entry => entry.entryType === EntryType.CREDIT)
            .reduce((sum, entry) => sum + cents(entry.amount), 0);
        if (debitAfter !== EXPECTED_SIDE_TOTAL || creditAfter !== EXPECTED_SIDE_TOTAL) {
            throw new Error(`Post-posting control failed: debit=${asMoney(debitAfter)}, credit=${asMoney(creditAfter)}`);
        }

        return {
            dryRun: false,
            branch: branch.name,
            targetLedgerId: target.id,
            created,
            debitTotal: asMoney(debitAfter),
            creditTotal: asMoney(creditAfter),
            combinedClosingBalance: asMoney(debitAfter - creditAfter)
        };
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
