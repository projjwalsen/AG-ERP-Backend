import "dotenv/config";
import { DebitCreditNoteSourceType, DebitCreditNoteType, EntryType, LedgerType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const AGENCY_NAME = "AVALANCHE IMPEX PRIVATE LIMITED-MAHA DR";
const TARGETS = [
    { noteNo: "SCN/M/2526/006", amount: 10_572_800 },
    { noteNo: "SCN/M/2526/007", amount: 12_083_200 }
] as const;
const apply = process.argv.includes("--apply");

function toCents(value: unknown) {
    return Math.round(Number(value ?? 0) * 100);
}

function distributeCents(amounts: number[], targetCents: number) {
    const oldTotal = amounts.reduce((sum, amount) => sum + amount, 0);
    if (oldTotal <= 0) throw new Error("Cannot rescale empty or zero-value posting lines.");
    let remaining = targetCents;
    return amounts.map((amount, index) => {
        const scaled = index === amounts.length - 1
            ? remaining
            : Math.round(targetCents * amount / oldTotal);
        remaining -= scaled;
        return scaled / 100;
    });
}

async function main() {
    const result = await prisma.$transaction(async tx => {
        const agency = await tx.agency.findFirst({
            where: { name: { equals: AGENCY_NAME, mode: "insensitive" } },
            select: { id: true, name: true }
        });
        if (!agency) throw new Error(`Agency not found: ${AGENCY_NAME}`);

        const notes = await tx.debitCreditNote.findMany({
            where: {
                agencyId: agency.id,
                noteNo: { in: TARGETS.map(target => target.noteNo) },
                type: DebitCreditNoteType.CREDIT_NOTE,
                sourceType: DebitCreditNoteSourceType.SALE
            },
            include: {
                particulars: true,
                voucher: { include: { entries: { include: { ledger: true } } } }
            }
        });

        const plans = TARGETS.map(target => {
            const matches = notes.filter(note => note.noteNo.toUpperCase() === target.noteNo.toUpperCase());
            if (matches.length !== 1) {
                throw new Error(`Expected one approved-sale credit note ${target.noteNo}; found ${matches.length}.`);
            }
            const note = matches[0];
            const voucher = note.voucher;
            if (!voucher || note.voucherId !== voucher.id || voucher.voucherType !== VoucherType.CREDIT_NOTE) {
                throw new Error(`Credit note ${target.noteNo} has no linked CREDIT_NOTE voucher.`);
            }

            const partyLines = voucher.entries.filter(entry =>
                entry.ledger.agencyId === agency.id &&
                [LedgerType.CUSTOMER, LedgerType.VENDOR].includes(entry.ledger.category) &&
                entry.entryType === EntryType.CREDIT
            );
            const offsetLines = voucher.entries.filter(entry =>
                entry.entryType === EntryType.DEBIT && !partyLines.some(party => party.id === entry.id)
            );
            if (partyLines.length !== 1 || offsetLines.length === 0) {
                throw new Error(`Credit note ${target.noteNo} does not have one agency credit and balanced debit adjustment lines.`);
            }

            const oldAmountCents = toCents(note.totalAmount);
            const partyCents = toCents(partyLines[0].amount);
            const offsetCents = offsetLines.reduce((sum, entry) => sum + toCents(entry.amount), 0);
            if (oldAmountCents <= 0 || partyCents !== oldAmountCents || offsetCents !== oldAmountCents ||
                toCents(voucher.totalDebit) !== oldAmountCents || toCents(voucher.totalCredit) !== oldAmountCents) {
                throw new Error(`Credit note ${target.noteNo} is not currently balanced to its stored total; refusing an automatic change.`);
            }

            if (note.particulars.length) {
                const particularsCents = note.particulars.reduce((sum, item) => sum + toCents(item.amount), 0);
                if (particularsCents !== oldAmountCents) {
                    throw new Error(`Credit note ${target.noteNo} particulars do not equal its stored total.`);
                }
            }

            const targetCents = toCents(target.amount);
            return {
                target,
                note,
                voucher,
                partyLine: partyLines[0],
                offsetLines,
                scaledOffsetAmounts: distributeCents(offsetLines.map(entry => toCents(entry.amount)), targetCents),
                scaledParticularAmounts: note.particulars.length
                    ? distributeCents(note.particulars.map(item => toCents(item.amount)), targetCents)
                    : [],
                oldAmount: oldAmountCents / 100
            };
        });

        const preview = plans.map(plan => ({
            noteNo: plan.target.noteNo,
            voucherNo: plan.voucher.voucherNo,
            oldAmount: plan.oldAmount,
            tallyAmount: plan.target.amount,
            agencyCreditLedger: plan.partyLine.ledger.name,
            adjustmentDebitLedgers: plan.offsetLines.map(entry => ({ ledger: entry.ledger.name, oldAmount: Number(entry.amount) })),
            action: apply ? "update" : "would-update"
        }));
        if (!apply) return { dryRun: true, agency: agency.name, notes: preview };

        const affectedLedgers = new Set<string>();
        for (const plan of plans) {
            await tx.debitCreditNote.update({
                where: { id: plan.note.id },
                data: { totalAmount: plan.target.amount }
            });
            await tx.ledgerEntry.update({
                where: { id: plan.partyLine.id },
                data: { amount: plan.target.amount }
            });
            affectedLedgers.add(plan.partyLine.ledgerId);

            for (const [index, entry] of plan.offsetLines.entries()) {
                await tx.ledgerEntry.update({ where: { id: entry.id }, data: { amount: plan.scaledOffsetAmounts[index] } });
                affectedLedgers.add(entry.ledgerId);
            }
            for (const [index, particular] of plan.note.particulars.entries()) {
                await tx.debitCreditNoteParticular.update({
                    where: { id: particular.id },
                    data: { amount: plan.scaledParticularAmounts[index] }
                });
            }
            await tx.voucher.update({
                where: { id: plan.voucher.id },
                data: { totalDebit: plan.target.amount, totalCredit: plan.target.amount }
            });
        }

        for (const ledgerId of affectedLedgers) await LedgerService.syncCachedBalance(tx, ledgerId);
        return { dryRun: false, agency: agency.name, notes: preview.map(note => ({ ...note, action: "updated" })) };
    }, { maxWait: 120_000, timeout: 5 * 60_000 });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
