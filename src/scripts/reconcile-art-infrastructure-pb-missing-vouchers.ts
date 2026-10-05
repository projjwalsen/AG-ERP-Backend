import "dotenv/config";
import {
    EntryType,
    JournalDirection,
    JournalHeadKind,
    JournalHeadType,
    JournalStatus,
    PaymentMode,
    PaymentType,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const AGENCY_ID = "cba93c38-8645-472a-8c29-32e7e28a9c17";
const AGENCY_LEDGER_ID = "853a9db9-7f64-4228-b070-abd19d88f4cc";
const TDS_LEDGER_ID = "06a529e6-4f51-4972-8c99-55b830bfbe5e";
const BANK_LEDGER_ID = "c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5";

const ROWS = [
    {
        voucherNo: "941",
        voucherType: VoucherType.JOURNAL,
        date: "2025-04-05",
        amount: 711,
        debitLedgerId: TDS_LEDGER_ID,
        creditLedgerId: AGENCY_LEDGER_ID,
        narration: "Agency ledger reconciliation: Journal 941, TDS Assets",
        direction: JournalDirection.INWARD,
        paymentThrough: null,
        importKey: `AGENCY_RECON:${AGENCY_ID}:JOURNAL:941:2025-04-05`
    },
    {
        voucherNo: "942",
        voucherType: VoucherType.JOURNAL,
        date: "2025-04-05",
        amount: 1205,
        debitLedgerId: TDS_LEDGER_ID,
        creditLedgerId: AGENCY_LEDGER_ID,
        narration: "Agency ledger reconciliation: Journal 942, TDS Assets",
        direction: JournalDirection.INWARD,
        paymentThrough: null,
        importKey: `AGENCY_RECON:${AGENCY_ID}:JOURNAL:942:2025-04-05`
    },
    {
        voucherNo: "13702",
        voucherType: VoucherType.PAYMENT,
        date: "2025-09-17",
        amount: 315795,
        debitLedgerId: AGENCY_LEDGER_ID,
        creditLedgerId: BANK_LEDGER_ID,
        narration: "Agency ledger reconciliation: Payment 13702 to ART INFRASTRUCTURE PRIVATE LIMITED - PB",
        direction: JournalDirection.OUTWARD,
        paymentThrough: PaymentType.NEFT,
        importKey: `AGENCY_RECON:${AGENCY_ID}:PAYMENT:13702:2025-09-17`
    }
] as const;

const apply = process.argv.includes("--apply");

function atIndiaMidnight(date: string) {
    return new Date(`${date}T00:00:00+05:30`);
}

function cents(value: unknown) {
    return Math.round(Number(value ?? 0) * 100);
}

async function main() {
    const result = await prisma.$transaction(async tx => {
        const [branch, agency, agencyLedger, tdsLedger, bankLedger] = await Promise.all([
            tx.branch.findUnique({ where: { id: BRANCH_ID }, select: { id: true, name: true, code: true } }),
            tx.agency.findUnique({ where: { id: AGENCY_ID }, select: { id: true, name: true } }),
            tx.ledger.findUnique({ where: { id: AGENCY_LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true, agencyId: true } }),
            tx.ledger.findUnique({ where: { id: TDS_LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true } }),
            tx.ledger.findUnique({ where: { id: BANK_LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true } })
        ]);

        if (!branch || !agency || !agencyLedger || !tdsLedger || !bankLedger) {
            throw new Error("A configured branch, agency, or ledger ID was not found; no changes were made.");
        }
        if (agency.name !== "ART INFRASTRUCTURE PRIVATE LIMITED - PB" ||
            agencyLedger.agencyId !== agency.id || agencyLedger.branchId !== branch.id ||
            agencyLedger.category !== "CUSTOMER" || tdsLedger.name.toUpperCase() !== "TDS ASSETS F.Y 2025-26" ||
            tdsLedger.branchId !== branch.id || tdsLedger.category !== "JOURNAL" ||
            bankLedger.name.toUpperCase() !== "BANK OF MAHARASHTRA- C/C 60434886441" ||
            bankLedger.branchId !== branch.id) {
            throw new Error("Configured IDs do not match the expected agency and ledger names; no changes were made.");
        }

        const actor = await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE" },
            select: { id: true }
        });
        if (!actor) throw new Error("No active user found to approve the journal records.");

        const existingByKey = await tx.voucher.findMany({
            where: { sourceId: { in: ROWS.map(row => row.importKey) } },
            include: { entries: true, journals: true }
        });
        const existingByNo = await tx.voucher.findMany({
            where: {
                branchId: BRANCH_ID,
                OR: ROWS.map(row => ({ voucherNo: row.voucherNo, voucherType: row.voucherType }))
            },
            include: { entries: true, journals: true }
        });

        const plans = ROWS.map(row => {
            const keyed = existingByKey.find(voucher => voucher.sourceId === row.importKey);
            const numbered = existingByNo.find(voucher =>
                voucher.voucherNo === row.voucherNo && voucher.voucherType === row.voucherType
            );
            if (keyed && numbered && keyed.id !== numbered.id) {
                throw new Error(`Voucher ${row.voucherNo} has conflicting source and number records; no changes were made.`);
            }
            const existing = keyed || numbered;
            if (existing) {
                const debit = existing.entries.find(entry => entry.ledgerId === row.debitLedgerId && entry.entryType === EntryType.DEBIT);
                const credit = existing.entries.find(entry => entry.ledgerId === row.creditLedgerId && entry.entryType === EntryType.CREDIT);
                const good = existing.branchId === BRANCH_ID &&
                    cents(debit?.amount) === cents(row.amount) && cents(credit?.amount) === cents(row.amount) &&
                    cents(existing.totalDebit) === cents(row.amount) && cents(existing.totalCredit) === cents(row.amount);
                if (!good) throw new Error(`Voucher ${row.voucherNo} already exists but differs from the requested posting; no changes were made.`);
                return { row, existing, action: "already-present" as const };
            }
            return { row, existing: null, action: apply ? "create" as const : "would-create" as const };
        });

        if (!apply) {
            return {
                dryRun: true,
                branch: branch.name,
                agency: agency.name,
                postings: plans.map(({ row, action }) => ({
                    voucherNo: row.voucherNo,
                    voucherType: row.voucherType,
                    date: row.date,
                    amount: row.amount,
                    debitLedger: row.debitLedgerId === AGENCY_LEDGER_ID ? agencyLedger.name : tdsLedger.name,
                    creditLedger: row.creditLedgerId === AGENCY_LEDGER_ID ? agencyLedger.name : bankLedger.name,
                    action
                }))
            };
        }

        const results = [];
        for (const { row, existing, action } of plans) {
            if (existing) {
                results.push({ voucherNo: row.voucherNo, action });
                continue;
            }

            let partyHead = await tx.journalHead.findFirst({
                where: { ledgerId: AGENCY_LEDGER_ID, name: { equals: agency.name, mode: "insensitive" } }
            });
            if (!partyHead) {
                partyHead = await tx.journalHead.create({
                    data: {
                        name: agency.name,
                        ledgerId: AGENCY_LEDGER_ID,
                        headType: JournalHeadKind.SUBHEAD,
                        type: row.direction === JournalDirection.OUTWARD ? JournalHeadType.OUTWARD : JournalHeadType.INWARD,
                        isActive: true
                    }
                });
            }

            const journal = await tx.journal.create({
                data: {
                    branchId: BRANCH_ID,
                    agencyId: AGENCY_ID,
                    journalHeadId: partyHead.id,
                    importKey: row.importKey,
                    voucherNo: row.voucherNo,
                    amount: row.amount,
                    direction: row.direction,
                    paymentMode: PaymentMode.ONLINE,
                    paymentThrough: row.paymentThrough,
                    remarks: row.narration,
                    journalDate: atIndiaMidnight(row.date),
                    status: JournalStatus.APPROVED,
                    createdById: actor.id,
                    approvedById: actor.id,
                    approvedAt: new Date()
                }
            });

            const voucher = await tx.voucher.create({
                data: {
                    voucherNo: row.voucherNo,
                    voucherType: row.voucherType,
                    sourceId: row.importKey,
                    branchId: BRANCH_ID,
                    narration: row.narration,
                    totalDebit: row.amount,
                    totalCredit: row.amount,
                    voucherDate: atIndiaMidnight(row.date),
                    entries: {
                        create: [
                            { ledgerId: row.debitLedgerId, branchId: BRANCH_ID, entryType: EntryType.DEBIT, amount: row.amount, narration: row.narration },
                            { ledgerId: row.creditLedgerId, branchId: BRANCH_ID, entryType: EntryType.CREDIT, amount: row.amount, narration: row.narration }
                        ]
                    }
                }
            });
            await tx.journal.update({ where: { id: journal.id }, data: { voucherId: voucher.id } });
            results.push({ voucherNo: row.voucherNo, voucherId: voucher.id, journalId: journal.id, action: "created" });
        }

        for (const ledgerId of new Set([AGENCY_LEDGER_ID, TDS_LEDGER_ID, BANK_LEDGER_ID])) {
            await LedgerService.syncCachedBalance(tx, ledgerId);
        }
        return { dryRun: false, branch: branch.name, agency: agency.name, postings: results };
    }, { maxWait: 120_000, timeout: 5 * 60_000 });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
