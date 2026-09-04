import "dotenv/config";
import {
    EntryType,
    JournalHeadType,
    JournalStatus,
    LedgerNature,
    LedgerType,
    PaymentMode,
    PaymentType,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const HEAD_NAME = "Interest on GST";
const DEFAULT_BANK_NAME = "BANK OF MAHARASHTRA- C/C 60434886441";
const IGST_LEDGER_NAME = "IGST CASH LEDGER";

const ROWS = [
    { date: "21-Apr-25", voucherNo: "11001", amount: 4414, counterLedger: "BANK" },
    { date: "19-May-25", voucherNo: "11506", amount: 8828, counterLedger: "BANK" },
    { date: "01-Aug-25", voucherNo: "5382", amount: 168021, counterLedger: "IGST" }
] as const;

const args = process.argv.slice(2);
const apply = args.includes("--apply");

function valueAfter(flag: string) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function parseDate(value: string) {
    const match = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Invalid date: ${value}`);

    const months: Record<string, string> = {
        JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
        JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"
    };
    const month = months[match[2].toUpperCase()];
    if (!month) throw new Error(`Invalid month in date: ${value}`);

    const year = Number(match[3]) >= 50 ? `19${match[3]}` : `20${match[3]}`;
    return new Date(`${year}-${month}-${match[1]}T00:00:00+05:30`);
}

function money(value: unknown) {
    return Number(Number(value || 0).toFixed(2));
}

async function main() {
    if (args.includes("--help")) {
        console.log(
            "Dry run: npm run create:interest-on-gst-journals\n" +
            "Apply:   npm run create:interest-on-gst-journals -- --apply\n" +
            "Options: --branch <branch-id> --bank-name <ledger-name>"
        );
        return;
    }

    const requestedBranchId = valueAfter("--branch");
    const bankName = valueAfter("--bank-name") || DEFAULT_BANK_NAME;

    const result = await prisma.$transaction(async tx => {
        const branches = await tx.branch.findMany({
            where: {
                isActive: true,
                ...(requestedBranchId ? { id: requestedBranchId } : {})
            },
            select: { id: true, code: true, name: true },
            orderBy: { createdAt: "asc" }
        });
        if (branches.length !== 1) {
            throw new Error(
                `Expected exactly one active branch; found ${branches.length}. ` +
                "Use --branch <branch-id>."
            );
        }
        const branch = branches[0];

        if (apply) await LedgerService.ensureDefaultLedgerGroups(tx);
        const indirectExpense = await tx.ledgerGroup.findUnique({
            where: { code: "INDIRECT_EXPENSE" }
        });
        if (!indirectExpense) throw new Error("INDIRECT_EXPENSE ledger group was not found");

        const matchingHeads = await tx.journalHead.findMany({
            where: { name: { equals: HEAD_NAME, mode: "insensitive" } },
            include: { ledger: true }
        });
        if (matchingHeads.length > 1) {
            throw new Error(`More than one JournalHead uses the name ${HEAD_NAME}`);
        }
        const existingHead = matchingHeads[0];
        if (!existingHead && !apply) {
            throw new Error(`${HEAD_NAME} JournalHead does not exist. Re-run with --apply to create it.`);
        }

        const interestLedger = existingHead
            ? apply
                ? await tx.ledger.update({
                    where: { id: existingHead.ledgerId },
                    data: {
                        name: HEAD_NAME,
                        category: LedgerType.JOURNAL,
                        groupId: indirectExpense.id,
                        nature: LedgerNature.DEBIT,
                        isActive: true
                    }
                })
                : existingHead.ledger
            : await LedgerService.getOrCreateLedger(tx, {
                code: "INTEREST-ON-GST",
                name: HEAD_NAME,
                category: LedgerType.JOURNAL,
                groupCode: "INDIRECT_EXPENSE",
                nature: LedgerNature.DEBIT
            });

        const interestHead = existingHead
            ? apply
                ? await tx.journalHead.update({
                    where: { id: existingHead.id },
                    data: {
                        name: HEAD_NAME,
                        type: JournalHeadType.OUTWARD,
                        isActive: true,
                        ledgerId: interestLedger.id
                    }
                })
                : existingHead
            : await tx.journalHead.create({
                data: {
                    name: HEAD_NAME,
                    type: JournalHeadType.OUTWARD,
                    ledgerId: interestLedger.id
                }
            });

        const bankLedgers = await tx.ledger.findMany({
            where: {
                category: LedgerType.BANK,
                branchId: branch.id,
                isActive: true,
                name: { equals: bankName, mode: "insensitive" }
            },
            select: { id: true, code: true, name: true }
        });
        if (bankLedgers.length !== 1) {
            throw new Error(
                `Expected exactly one active BANK ledger named ${bankName} for branch ${branch.code}; found ${bankLedgers.length}`
            );
        }
        const bankLedger = bankLedgers[0];

        const igstLedgers = await tx.ledger.findMany({
            where: {
                isActive: true,
                name: { equals: IGST_LEDGER_NAME, mode: "insensitive" }
            },
            select: { id: true, code: true, name: true }
        });
        if (igstLedgers.length !== 1) {
            throw new Error(
                `Expected exactly one active ledger named ${IGST_LEDGER_NAME}; found ${igstLedgers.length}`
            );
        }
        const igstLedger = igstLedgers[0];

        const existingVouchers = await tx.voucher.findMany({
            where: { voucherNo: { in: ROWS.map(row => row.voucherNo) } },
            select: { voucherNo: true, voucherType: true }
        });
        if (existingVouchers.length) {
            throw new Error(
                `Voucher number(s) already exist: ${existingVouchers
                    .map(voucher => `${voucher.voucherNo} (${voucher.voucherType})`)
                    .join(", ")}. Nothing was changed.`
            );
        }

        const actor = await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE" },
            select: { id: true, name: true }
        });
        if (!actor) throw new Error("No active user is available for createdBy/approvedBy");

        const total = ROWS.reduce((sum, row) => sum + row.amount, 0);
        const preview = ROWS.map(row => ({
            ...row,
            voucherType: VoucherType.JOURNAL,
            debitLedger: HEAD_NAME,
            creditLedger: row.counterLedger === "BANK" ? bankLedger.name : igstLedger.name,
            paymentMode: PaymentMode.ONLINE,
            paymentThrough: row.counterLedger === "BANK" ? PaymentType.CHEQUE : null,
            action: apply ? "create-and-approve" : "would-create-and-approve"
        }));

        if (!apply) {
            return {
                branch,
                interestHead: interestHead.name,
                bankLedger,
                igstLedger,
                totalInterestOnGSTDebit: money(total),
                vouchers: preview,
                dryRun: true
            };
        }

        const created = [];
        for (const row of ROWS) {
            const journalDate = parseDate(row.date);
            const counterLedger = row.counterLedger === "BANK" ? bankLedger : igstLedger;
            const importKey = `REPAIR_INTEREST_ON_GST_${row.voucherNo}`;

            const existingJournal = await tx.journal.findUnique({
                where: { importKey },
                select: { id: true }
            });
            if (existingJournal) {
                throw new Error(`Repair journal already exists for voucher ${row.voucherNo}; nothing was changed`);
            }

            const journal = await tx.journal.create({
                data: {
                    branchId: branch.id,
                    journalHeadId: interestHead.id,
                    importKey,
                    amount: row.amount,
                    paymentMode: PaymentMode.ONLINE,
                    paymentThrough: row.counterLedger === "BANK" ? PaymentType.CHEQUE : null,
                    remarks: `Interest on GST - voucher ${row.voucherNo}`,
                    journalDate,
                    status: JournalStatus.PENDING,
                    createdById: actor.id
                }
            });

            const voucher = await tx.voucher.create({
                data: {
                    voucherNo: row.voucherNo,
                    voucherType: VoucherType.JOURNAL,
                    sourceId: journal.id,
                    branchId: branch.id,
                    narration: journal.remarks,
                    totalDebit: row.amount,
                    totalCredit: row.amount,
                    voucherDate: journalDate,
                    entries: {
                        create: [
                            {
                                ledgerId: interestLedger.id,
                                branchId: branch.id,
                                entryType: EntryType.DEBIT,
                                amount: row.amount,
                                narration: journal.remarks
                            },
                            {
                                ledgerId: counterLedger.id,
                                branchId: branch.id,
                                entryType: EntryType.CREDIT,
                                amount: row.amount,
                                narration: journal.remarks
                            }
                        ]
                    }
                },
                select: { id: true, voucherNo: true }
            });

            const approved = await tx.journal.update({
                where: { id: journal.id },
                data: {
                    status: JournalStatus.APPROVED,
                    approvedById: actor.id,
                    approvedAt: new Date(),
                    voucherId: voucher.id
                },
                select: { id: true, status: true, voucherId: true }
            });

            await LedgerService.syncCachedBalance(tx, interestLedger.id);
            await LedgerService.syncCachedBalance(tx, counterLedger.id);
            created.push({
                date: row.date,
                voucherNo: voucher.voucherNo,
                voucherId: voucher.id,
                journalId: approved.id,
                status: approved.status,
                debit: money(row.amount),
                credit: money(row.amount),
                creditLedger: counterLedger.name
            });
        }

        return {
            branch,
            interestHead: interestHead.name,
            bankLedger,
            igstLedger,
            totalInterestOnGSTDebit: money(total),
            vouchers: created,
            dryRun: false
        };
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify(result, null, 2));
    if (result.dryRun) {
        console.log("Dry run only. Re-run with --apply to create all 3 vouchers.");
    }
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
