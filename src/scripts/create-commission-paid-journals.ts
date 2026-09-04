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

const AMOUNT = 200_000;
const VOUCHER_NUMBERS = ["187", "188"];
const HEAD_NAME = "Commission Paid";
const DEFAULT_BANK_NAME = "Bank of Maharashtra";

const args = process.argv.slice(2);
const apply = args.includes("--apply");

function valueAfter(flag: string) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function parseDate(value?: string) {
    if (!value) return new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("--date must use YYYY-MM-DD format");
    }

    const date = new Date(`${value}T00:00:00+05:30`);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid --date");
    return date;
}

function money(value: unknown) {
    return Number(Number(value || 0).toFixed(2));
}

async function main() {
    if (args.includes("--help")) {
        console.log(
            "Dry run: npm run create:commission-paid-journals\n" +
            "Apply:   npm run create:commission-paid-journals -- --apply\n" +
            "Options: --branch <branch-id> --bank-name <ledger-name> --date YYYY-MM-DD"
        );
        return;
    }

    const requestedBranchId = valueAfter("--branch");
    const bankName = valueAfter("--bank-name") || DEFAULT_BANK_NAME;
    const journalDate = parseDate(valueAfter("--date"));

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

        const heads = await tx.journalHead.findMany({
            where: {
                name: { equals: HEAD_NAME, mode: "insensitive" },
                type: JournalHeadType.OUTWARD,
                isActive: true
            },
            include: { ledger: true }
        });
        if (heads.length !== 1) {
            throw new Error(
                `Expected exactly one active OUTWARD JournalHead named ${HEAD_NAME}; found ${heads.length}`
            );
        }
        const commissionHead = heads[0];
        if (
            commissionHead.ledger.category !== LedgerType.JOURNAL ||
            commissionHead.ledger.nature !== LedgerNature.DEBIT ||
            !commissionHead.ledger.isActive
        ) {
            throw new Error("Commission Paid is not an active debit JOURNAL ledger");
        }

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

        const existingVouchers = await tx.voucher.findMany({
            where: { voucherNo: { in: VOUCHER_NUMBERS } },
            select: { id: true, voucherNo: true, voucherType: true }
        });
        if (existingVouchers.length) {
            throw new Error(
                `Voucher number(s) already exist: ${existingVouchers
                    .map(v => `${v.voucherNo} (${v.voucherType})`)
                    .join(", ")}. Nothing was changed.`
            );
        }

        const actor = await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE" },
            select: { id: true, name: true }
        });
        if (!actor) throw new Error("No active user is available for createdBy/approvedBy");

        const preview = VOUCHER_NUMBERS.map(voucherNo => ({
            voucherNo,
            voucherType: VoucherType.JOURNAL,
            journalHead: HEAD_NAME,
            debitLedger: commissionHead.ledger.name,
            debit: AMOUNT,
            creditLedger: bankLedger.name,
            credit: AMOUNT,
            paymentMode: PaymentMode.ONLINE,
            paymentThrough: PaymentType.CHEQUE,
            date: journalDate.toISOString(),
            action: apply ? "create-and-approve" : "would-create-and-approve"
        }));

        if (!apply) {
            return {
                branch,
                actor,
                commissionHead: commissionHead.ledger.name,
                bankLedger,
                vouchers: preview,
                dryRun: true
            };
        }

        const created = [];
        for (const voucherNo of VOUCHER_NUMBERS) {
            const importKey = `REPAIR_COMMISSION_PAID_${voucherNo}`;
            const existingJournal = await tx.journal.findUnique({
                where: { importKey },
                select: { id: true }
            });
            if (existingJournal) {
                throw new Error(`Repair journal already exists for voucher ${voucherNo}; nothing was changed`);
            }

            const journal = await tx.journal.create({
                data: {
                    branchId: branch.id,
                    journalHeadId: commissionHead.id,
                    importKey,
                    amount: AMOUNT,
                    paymentMode: PaymentMode.ONLINE,
                    paymentThrough: PaymentType.CHEQUE,
                    remarks: `Commission Paid - voucher ${voucherNo}`,
                    journalDate,
                    status: JournalStatus.PENDING,
                    createdById: actor.id
                }
            });

            const voucher = await tx.voucher.create({
                data: {
                    voucherNo,
                    voucherType: VoucherType.JOURNAL,
                    sourceId: journal.id,
                    branchId: branch.id,
                    narration: journal.remarks,
                    totalDebit: AMOUNT,
                    totalCredit: AMOUNT,
                    voucherDate: journalDate,
                    entries: {
                        create: [
                            {
                                ledgerId: commissionHead.ledgerId,
                                branchId: branch.id,
                                entryType: EntryType.DEBIT,
                                amount: AMOUNT,
                                narration: journal.remarks
                            },
                            {
                                ledgerId: bankLedger.id,
                                branchId: branch.id,
                                entryType: EntryType.CREDIT,
                                amount: AMOUNT,
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

            await LedgerService.syncCachedBalance(tx, commissionHead.ledgerId);
            await LedgerService.syncCachedBalance(tx, bankLedger.id);

            created.push({
                voucherNo: voucher.voucherNo,
                voucherId: voucher.id,
                journalId: approved.id,
                status: approved.status,
                amount: money(AMOUNT)
            });
        }

        return {
            branch,
            actor,
            commissionHead: commissionHead.ledger.name,
            bankLedger,
            vouchers: created,
            dryRun: false
        };
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify(result, null, 2));
    if (result.dryRun) {
        console.log("Dry run only. Re-run with --apply to create both vouchers.");
    }
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
