import { EntryType, LedgerType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";

/** Moves the imported OP/1 opening balance from Bank Accounts to Cash-in-Hand. */
async function main() {
    const opening = await prisma.voucher.findFirst({
        where: { voucherType: VoucherType.OPENING_BALANCE, voucherNo: "OP/1" },
        include: { entries: true }
    });
    if (!opening) throw new Error("Opening balance voucher OP/1 was not found");

    const cash = await prisma.ledger.findFirst({
        where: { category: LedgerType.CASH, isActive: true },
        orderBy: { createdAt: "asc" }
    });
    if (!cash) throw new Error("Active Cash-in-Hand ledger was not found");

    const amount = Math.max(...opening.entries.map(entry => Number(entry.amount || 0)));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Opening balance amount is invalid");

    await prisma.$transaction(async tx => {
        const existingCashEntry = opening.entries.find(entry => entry.ledgerId === cash.id);
        const paymentEntry = existingCashEntry || opening.entries.find(entry => entry.entryType === EntryType.CREDIT);
        const counterpart = opening.entries.find(entry => entry.id !== paymentEntry?.id);
        if (paymentEntry) {
            await tx.ledgerEntry.update({
                where: { id: paymentEntry.id },
                data: { ledgerId: cash.id, entryType: EntryType.DEBIT, amount }
            });
        } else {
            throw new Error("Opening balance voucher has no ledger entries");
        }

        if (counterpart) {
            await tx.ledgerEntry.update({
                where: { id: counterpart.id },
                data: { entryType: EntryType.CREDIT, amount }
            });
        }
    });

    console.log(JSON.stringify({ voucher: opening.voucherNo, cashLedger: cash.name, amount }));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
