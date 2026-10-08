import "dotenv/config";
import { EntryType, LedgerType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const VOUCHER_NO = "OPN-E297B7FE";
const AMOUNT = 161999.84;
const OLD_LEDGER_NAME = "Airconditioner";
const TARGET_LEDGER_NAME = "Air Conditioner - Office";
const apply = process.argv.includes("--apply");

const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

async function main() {
    const voucher = await prisma.voucher.findFirst({
        where: { voucherNo: VOUCHER_NO, voucherType: VoucherType.OPENING_BALANCE },
        include: { entries: { include: { ledger: true } } }
    });

    if (!voucher) throw new Error(`Opening voucher ${VOUCHER_NO} was not found`);

    const sourceEntries = voucher.entries.filter(entry =>
        entry.entryType === EntryType.DEBIT &&
        money(entry.amount) === AMOUNT &&
        entry.ledger.category === LedgerType.JOURNAL &&
        entry.ledger.name.trim().toUpperCase() === OLD_LEDGER_NAME.toUpperCase()
    );

    const target = await prisma.ledger.findFirst({
        where: {
            name: { equals: TARGET_LEDGER_NAME, mode: "insensitive" },
            branchId: voucher.branchId
        }
    });

    if (!target) throw new Error(`Target ledger ${TARGET_LEDGER_NAME} was not found for branch ${voucher.branchId}`);

    if (sourceEntries.length === 0) {
        const repairedEntries = voucher.entries.filter(entry =>
            entry.entryType === EntryType.DEBIT &&
            money(entry.amount) === AMOUNT &&
            entry.ledgerId === target.id
        );

        if (repairedEntries.length === 1) {
            console.log(JSON.stringify({
                voucherNo: voucher.voucherNo,
                voucherId: voucher.id,
                amount: AMOUNT,
                targetLedger: { id: target.id, name: target.name, branchId: target.branchId },
                action: "already-repaired",
                dryRun: false
            }, null, 2));
            return;
        }
    }

    if (sourceEntries.length !== 1) {
        throw new Error(`Expected exactly one ${OLD_LEDGER_NAME} debit entry of ${AMOUNT}; found ${sourceEntries.length}`);
    }

    const source = sourceEntries[0];

    const preview = {
        voucherNo: voucher.voucherNo,
        voucherId: voucher.id,
        amount: money(source.amount),
        sourceLedger: { id: source.ledger.id, name: source.ledger.name, branchId: source.ledger.branchId },
        targetLedger: { id: target.id, name: target.name, branchId: target.branchId },
        action: apply ? "move-opening-entry-and-sync-balances" : "would-move-opening-entry",
        dryRun: !apply
    };

    console.log(JSON.stringify(preview, null, 2));

    if (!apply) {
        console.log("Dry run only. Re-run with --apply after verifying the target ledger.");
        return;
    }

    await prisma.$transaction(async tx => {
        await tx.ledgerEntry.update({
            where: { id: source.id },
            data: { ledgerId: target.id }
        });

        await LedgerService.syncCachedBalance(tx as any, source.ledger.id);
        await LedgerService.syncCachedBalance(tx as any, target.id);
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify({ ...preview, dryRun: false }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
