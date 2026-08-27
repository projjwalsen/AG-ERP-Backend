import { EntryType, JournalHeadType } from "@prisma/client";
import { prisma } from "../config/db";

/**
 * Move all journals belonging to one JournalHead to the debit side.
 *
 * Journal.amount is a single amount. The accounting side is represented by
 * the JournalHead type and by the LedgerEntry rows in the approved voucher:
 *
 *   OUTWARD => journal-head ledger DEBIT, payment ledger CREDIT
 *
 * This script is idempotent and repairs already-approved journal vouchers.
 * It does not change Journal.amount or create duplicate journals/vouchers.
 *
 * Run:
 *   npx tsx src/scripts/fix-journal-head-to-debit.ts
 *   npx tsx src/scripts/fix-journal-head-to-debit.ts <journal-head-id>
 */


const DEFAULT_JOURNAL_HEAD_ID = "6dd9ceb3-4974-44a1-bdc8-19152c9e5a00";
const journalHeadId = process.argv[2] || DEFAULT_JOURNAL_HEAD_ID;

async function main() {
    const result = await prisma.$transaction(async (tx) => {
        const journalHead = await tx.journalHead.findUnique({
            where: { id: journalHeadId },
            select: {
                id: true,
                name: true,
                type: true,
                ledgerId: true
            }
        });

        if (!journalHead) {
            throw new Error(`Journal head not found: ${journalHeadId}`);
        }

        const journals = await tx.journal.findMany({
            where: { journalHeadId },
            select: {
                id: true,
                status: true,
                voucherId: true,
                amount: true
            }
        });

        let repairedVouchers = 0;
        let pendingOrUnposted = 0;

        for (const journal of journals) {
            if (!journal.voucherId) {
                pendingOrUnposted++;
                continue;
            }

            const headEntry = await tx.ledgerEntry.updateMany({
                where: {
                    voucherId: journal.voucherId,
                    ledgerId: journalHead.ledgerId
                },
                data: { entryType: EntryType.DEBIT }
            });

            if (headEntry.count !== 1) {
                throw new Error(
                    `Expected exactly one journal-head entry for journal ${journal.id}; found ${headEntry.count}`
                );
            }

            const paymentEntries = await tx.ledgerEntry.updateMany({
                where: {
                    voucherId: journal.voucherId,
                    ledgerId: { not: journalHead.ledgerId }
                },
                data: { entryType: EntryType.CREDIT }
            });

            if (paymentEntries.count < 1) {
                throw new Error(
                    `No payment entry found for journal ${journal.id}`
                );
            }

            repairedVouchers++;
        }

        await tx.journalHead.update({
            where: { id: journalHeadId },
            data: { type: JournalHeadType.OUTWARD }
        });

        return {
            journalHead,
            journals: journals.length,
            repairedVouchers,
            pendingOrUnposted
        };
    });

    console.log(`Journal head: ${result.journalHead.name} (${journalHeadId})`);
    console.log(`Type: ${result.journalHead.type} -> ${JournalHeadType.OUTWARD}`);
    console.log(`Journals found: ${result.journals}`);
    console.log(`Approved vouchers repaired: ${result.repairedVouchers}`);
    console.log(`Unposted journals left for future approval: ${result.pendingOrUnposted}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());

