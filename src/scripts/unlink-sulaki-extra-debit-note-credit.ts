import "dotenv/config";
import { EntryType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const AGENCY_ID = "df77955f-e195-42ab-91d6-8e196f3c17a2";
const SULAKI_LEDGER_ID = "c30758e9-fcdd-4f89-95c0-ce0416b7defa";
const ADJUSTMENT_LEDGER_ID = "818d72ee-94a4-428f-a184-562640ef4d59";
const VOUCHER_ID = "248792b5-eb51-4bdf-975f-61c023acf6f1";
const ENTRY_ID = "b9769a8b-ef87-4024-9705-8d8ad1840a82";
const COUNTER_ENTRY_ID = "3e3f371e-a53a-4d33-be19-72ba09d00af4";
const NOTE_NO = "SDN/M/2526/008";
const AMOUNT = 449545;

async function main() {
    const result = await prisma.$transaction(async tx => {
        const [agency, sulakiLedger, adjustmentLedger, voucher] = await Promise.all([
            tx.agency.findUnique({ where: { id: AGENCY_ID }, select: { id: true, name: true } }),
            tx.ledger.findUnique({ where: { id: SULAKI_LEDGER_ID }, select: { id: true, name: true, agencyId: true, branchId: true } }),
            tx.ledger.findUnique({ where: { id: ADJUSTMENT_LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true } }),
            tx.voucher.findUnique({ where: { id: VOUCHER_ID }, include: { entries: true, debitCreditNotes: true } })
        ]);
        if (!agency || agency.name !== "Sulaki Chemicals Pvt. Ltd. (Drs)" ||
            !sulakiLedger || sulakiLedger.agencyId !== AGENCY_ID || sulakiLedger.branchId !== BRANCH_ID ||
            !adjustmentLedger || adjustmentLedger.name !== "Sales Debit Note Adjustments" || adjustmentLedger.branchId !== BRANCH_ID ||
            !voucher || voucher.branchId !== BRANCH_ID || voucher.voucherType !== VoucherType.DEBIT_NOTE ||
            voucher.voucherNo !== "DBN-48376FEA-70D0E939CE" || Number(voucher.totalDebit) !== AMOUNT || Number(voucher.totalCredit) !== AMOUNT) {
            throw new Error("Agency, ledgers, or exact duplicate debit-note voucher did not match; no changes made.");
        }
        const customerEntry = voucher.entries.find(e => e.id === ENTRY_ID);
        const counterEntry = voucher.entries.find(e => e.id === COUNTER_ENTRY_ID);
        const note = voucher.debitCreditNotes.find(n => n.noteNo === NOTE_NO);
        if (!customerEntry || !counterEntry || !note || note.status !== "APPROVED" || Number(note.totalAmount) !== AMOUNT) {
            throw new Error("Expected approved note and both paired entries were not found; no changes made.");
        }
        if (customerEntry.ledgerId === ADJUSTMENT_LEDGER_ID && counterEntry.ledgerId === ADJUSTMENT_LEDGER_ID && note.agencyId === null) {
            return { action: "already-unlinked", noteNo: NOTE_NO, voucherNo: voucher.voucherNo };
        }
        if (customerEntry.ledgerId !== SULAKI_LEDGER_ID || customerEntry.entryType !== EntryType.CREDIT || Number(customerEntry.amount) !== AMOUNT ||
            counterEntry.ledgerId !== ADJUSTMENT_LEDGER_ID || counterEntry.entryType !== EntryType.DEBIT || Number(counterEntry.amount) !== AMOUNT ||
            note.agencyId !== AGENCY_ID) {
            throw new Error("The extra credit posting has changed or does not match the expected pair; no changes made.");
        }

        // Keep the voucher balanced while removing this duplicate posting from Sulaki's party ledger.
        await tx.ledgerEntry.update({ where: { id: ENTRY_ID }, data: { ledgerId: ADJUSTMENT_LEDGER_ID } });
        const noteUpdate = await tx.$executeRaw`
            UPDATE "DebitCreditNote"
            SET "agencyId" = NULL
            WHERE id = ${note.id} AND "voucherId" = ${VOUCHER_ID} AND "agencyId" = ${AGENCY_ID}
        `;
        if (Number(noteUpdate) !== 1) throw new Error("Could not unlink the exact debit note from Sulaki; transaction rolled back.");
        await Promise.all([
            LedgerService.syncCachedBalance(tx, SULAKI_LEDGER_ID),
            LedgerService.syncCachedBalance(tx, ADJUSTMENT_LEDGER_ID)
        ]);
        return {
            action: "unlinked-from-sulaki",
            noteNo: NOTE_NO,
            systemVoucherNo: voucher.voucherNo,
            amount: AMOUNT,
            movedCreditPostingFrom: sulakiLedger.name,
            movedCreditPostingTo: adjustmentLedger.name,
            balancedCounterEntryRemains: true
        };
    }, { maxWait: 60_000, timeout: 5 * 60_000 });
    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
