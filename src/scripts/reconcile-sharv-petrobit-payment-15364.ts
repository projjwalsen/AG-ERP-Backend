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
const AGENCY_ID = "1abd8977-febd-47ab-a231-36982f8bd894";
const AGENCY_LEDGER_ID = "746475ad-26a9-4817-865e-fc0a7d8c5740";
const BANK_LEDGER_ID = "c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5";
const VOUCHER_NO = "15364";
const AMOUNT = 7_000_100;
const DATE = "2025-11-24";
const IMPORT_KEY = `AGENCY_RECON:${AGENCY_ID}:PAYMENT:${VOUCHER_NO}:${DATE}`;
const NARRATION = "Agency ledger reconciliation: Payment 15364 to SHARV PETROBIT PRIVATE LIMITED";

function atIndiaMidnight(date: string) {
    return new Date(`${date}T00:00:00+05:30`);
}

async function main() {
    const apply = process.argv.includes("--apply");
    const result = await prisma.$transaction(async tx => {
        const [branch, agency, agencyLedger, bankLedger] = await Promise.all([
            tx.branch.findUnique({ where: { id: BRANCH_ID }, select: { id: true, name: true } }),
            tx.agency.findUnique({ where: { id: AGENCY_ID }, select: { id: true, name: true } }),
            tx.ledger.findUnique({ where: { id: AGENCY_LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true, agencyId: true } }),
            tx.ledger.findUnique({ where: { id: BANK_LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true } })
        ]);

        if (!branch || !agency || !agencyLedger || !bankLedger ||
            agency.name !== "SHARV PETROBIT PRIVATE LIMITED" ||
            agencyLedger.name !== "SHARV PETROBIT PRIVATE LIMITED - Sundry Debtor" ||
            agencyLedger.agencyId !== agency.id || agencyLedger.category !== "CUSTOMER" ||
            agencyLedger.branchId !== branch.id || bankLedger.branchId !== branch.id ||
            bankLedger.name.toUpperCase() !== "BANK OF MAHARASHTRA- C/C 60434886441") {
            throw new Error("Agency, debtor ledger, bank ledger, or branch validation failed; no changes made.");
        }

        const [sameKey, sameTypeNo, exactAmountPayments] = await Promise.all([
            tx.voucher.findUnique({ where: { voucherType_sourceId: { voucherType: VoucherType.PAYMENT, sourceId: IMPORT_KEY } }, include: { entries: true } }),
            tx.voucher.findMany({ where: { branchId: BRANCH_ID, voucherNo: VOUCHER_NO, voucherType: VoucherType.PAYMENT }, include: { entries: true } }),
            tx.voucher.findMany({
                where: {
                    branchId: BRANCH_ID,
                    voucherType: VoucherType.PAYMENT,
                    voucherDate: atIndiaMidnight(DATE),
                    totalDebit: AMOUNT,
                    totalCredit: AMOUNT
                },
                include: { entries: true }
            })
        ]);

        const existing = sameKey ?? sameTypeNo[0];
        if (sameTypeNo.length > 1) throw new Error("Multiple PAYMENT vouchers already use number 15364; no changes made.");
        if (existing) {
            const debit = existing.entries.find(entry => entry.ledgerId === AGENCY_LEDGER_ID && entry.entryType === EntryType.DEBIT);
            const credit = existing.entries.find(entry => entry.ledgerId === BANK_LEDGER_ID && entry.entryType === EntryType.CREDIT);
            if (existing.branchId !== BRANCH_ID || existing.voucherType !== VoucherType.PAYMENT ||
                Number(existing.totalDebit) !== AMOUNT || Number(existing.totalCredit) !== AMOUNT ||
                Number(debit?.amount) !== AMOUNT || Number(credit?.amount) !== AMOUNT) {
                throw new Error("A PAYMENT 15364 already exists with different details; no changes made.");
            }
            return { action: "already-present-and-linked", voucherId: existing.id, agency: agency.name, branch: branch.name };
        }
        if (exactAmountPayments.length) {
            throw new Error(`A PAYMENT for ₹${AMOUNT.toLocaleString("en-IN")} dated ${DATE} already exists under another voucher number; review required. No changes made.`);
        }
        if (!apply) {
            return { action: "preview-only", wouldCreate: { voucherNo: VOUCHER_NO, voucherType: "PAYMENT", date: DATE, amount: AMOUNT, debit: agencyLedger.name, credit: bankLedger.name }, agency: agency.name, branch: branch.name };
        }

        const actor = await tx.user.findFirst({ where: { isActive: true, status: "ACTIVE" }, select: { id: true } });
        if (!actor) throw new Error("No active user found to approve the voucher; no changes made.");

        let partyHead = await tx.journalHead.findFirst({
            where: {
                ledgerId: AGENCY_LEDGER_ID,
                headType: JournalHeadKind.SUBHEAD,
                OR: [{ type: JournalHeadType.OUTWARD }, { type: null }]
            }
        });
        if (!partyHead) {
            partyHead = await tx.journalHead.create({
                data: {
                    name: `${agency.name} Reconciliation Payments`,
                    ledgerId: AGENCY_LEDGER_ID,
                    headType: JournalHeadKind.SUBHEAD,
                    type: JournalHeadType.OUTWARD,
                    isActive: true
                }
            });
        }

        const journal = await tx.journal.create({
            data: {
                branchId: BRANCH_ID,
                agencyId: AGENCY_ID,
                journalHeadId: partyHead.id,
                importKey: IMPORT_KEY,
                voucherNo: VOUCHER_NO,
                amount: AMOUNT,
                direction: JournalDirection.OUTWARD,
                paymentMode: PaymentMode.ONLINE,
                paymentThrough: PaymentType.BANK_DEPOSIT,
                remarks: NARRATION,
                journalDate: atIndiaMidnight(DATE),
                status: JournalStatus.APPROVED,
                createdById: actor.id,
                approvedById: actor.id,
                approvedAt: new Date()
            }
        });

        const voucher = await tx.voucher.create({
            data: {
                voucherNo: VOUCHER_NO,
                voucherType: VoucherType.PAYMENT,
                sourceId: IMPORT_KEY,
                branchId: BRANCH_ID,
                narration: NARRATION,
                totalDebit: AMOUNT,
                totalCredit: AMOUNT,
                voucherDate: atIndiaMidnight(DATE),
                entries: {
                    create: [
                        { ledgerId: AGENCY_LEDGER_ID, branchId: BRANCH_ID, entryType: EntryType.DEBIT, amount: AMOUNT, narration: NARRATION },
                        { ledgerId: BANK_LEDGER_ID, branchId: BRANCH_ID, entryType: EntryType.CREDIT, amount: AMOUNT, narration: NARRATION }
                    ]
                }
            }
        });
        await tx.journal.update({ where: { id: journal.id }, data: { voucherId: voucher.id } });
        await Promise.all([
            LedgerService.syncCachedBalance(tx, AGENCY_LEDGER_ID),
            LedgerService.syncCachedBalance(tx, BANK_LEDGER_ID)
        ]);
        return { action: "created-and-linked", voucherId: voucher.id, journalId: journal.id, agency: agency.name, branch: branch.name, date: DATE, amount: AMOUNT };
    }, { maxWait: 120_000, timeout: 5 * 60_000 });

    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
