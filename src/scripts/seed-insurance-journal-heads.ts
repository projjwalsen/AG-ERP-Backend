import {
    EntryType,
    JournalHeadType,
    LedgerNature,
    LedgerType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

/**
 * Creates the Tally-style Insurance group and its journal heads.
 *
 * The Insurance group is the cumulative parent. The six names below are
 * child ledgers/journal heads. Existing matching heads are moved under the
 * Insurance group, so their existing journal vouchers are retained.
 *
 * Run:
 *   npx tsx src/scripts/seed-insurance-journal-heads.ts
 */

const INSURANCE_GROUP_CODE = "INSURANCE";
const INSURANCE_GROUP_NAME = "Insurance";

const INSURANCE_HEADS = [
    "FACTORY INSURANCE",
    "INSURANCE ON LOAN",
    "FIRE INSURANCE",
    "INSURANCE",
    "INSURANCE - VEHICLES",
    "PROPERTY INSURANCE"
] as const;

const normalizeCode = (value: string) =>
    value
        .replace(/[^A-Z0-9]/gi, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toUpperCase();

async function main() {
    const result = await prisma.$transaction(async (tx) => {
        await LedgerService.ensureDefaultLedgerGroups(tx);

        const indirectExpense = await tx.ledgerGroup.findUnique({
            where: { code: "INDIRECT_EXPENSE" }
        });

        if (!indirectExpense) {
            throw new Error("INDIRECT_EXPENSE ledger group was not found");
        }

        const insuranceGroup = await tx.ledgerGroup.upsert({
            where: { code: INSURANCE_GROUP_CODE },
            update: {
                name: INSURANCE_GROUP_NAME,
                parentId: indirectExpense.id,
                nature: LedgerNature.DEBIT
            },
            create: {
                code: INSURANCE_GROUP_CODE,
                name: INSURANCE_GROUP_NAME,
                parentId: indirectExpense.id,
                nature: LedgerNature.DEBIT
            }
        });

        let createdHeads = 0;
        let updatedHeads = 0;
        let movedLedgers = 0;
        let repairedVouchers = 0;

        for (const name of INSURANCE_HEADS) {
            let journalHead = await tx.journalHead.findFirst({
                where: {
                    name: { equals: name, mode: "insensitive" }
                },
                include: { ledger: true }
            });

            if (!journalHead) {
                const ledger = await tx.ledger.create({
                    data: {
                        code: `INSURANCE-${normalizeCode(name)}`,
                        name,
                        category: LedgerType.JOURNAL,
                        groupId: insuranceGroup.id,
                        nature: LedgerNature.DEBIT
                    }
                });

                journalHead = await tx.journalHead.create({
                    data: {
                        name,
                        type: JournalHeadType.OUTWARD,
                        ledgerId: ledger.id
                    },
                    include: { ledger: true }
                });
                createdHeads++;
            } else {
                await tx.ledger.update({
                    where: { id: journalHead.ledgerId },
                    data: {
                        groupId: insuranceGroup.id,
                        category: LedgerType.JOURNAL,
                        nature: LedgerNature.DEBIT
                    }
                });

                await tx.journalHead.update({
                    where: { id: journalHead.id },
                    data: { type: JournalHeadType.OUTWARD }
                });
                updatedHeads++;
            }

            const journals = await tx.journal.findMany({
                where: { journalHeadId: journalHead.id },
                select: { id: true, voucherId: true }
            });

            for (const journal of journals) {
                if (!journal.voucherId) continue;

                const headEntry = await tx.ledgerEntry.updateMany({
                    where: {
                        voucherId: journal.voucherId,
                        ledgerId: journalHead.ledgerId
                    },
                    data: { entryType: EntryType.DEBIT }
                });

                if (headEntry.count !== 1) {
                    throw new Error(
                        `Expected one Insurance head entry for journal ${journal.id}; found ${headEntry.count}`
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
                    throw new Error(`No payment entry found for journal ${journal.id}`);
                }

                repairedVouchers++;
            }

            movedLedgers++;
        }

        return {
            group: insuranceGroup,
            createdHeads,
            updatedHeads,
            movedLedgers,
            repairedVouchers
        };
    });

    console.log(`Insurance group ready: ${result.group.name}`);
    console.log(`Journal heads created: ${result.createdHeads}`);
    console.log(`Journal heads updated: ${result.updatedHeads}`);
    console.log(`Insurance child ledgers mapped: ${result.movedLedgers}`);
    console.log(`Existing journal vouchers repaired: ${result.repairedVouchers}`);
    console.log("The Trial Balance Insurance group will show the cumulative child total.");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
