import {
    EntryType,
    JournalHeadType,
    LedgerNature,
    LedgerType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

/**
 * Creates the Tally-style Land group and its child journal heads.
 *
 * Existing matching heads and their ledgers are reused and moved under Land.
 * Existing approved journal vouchers are repaired so the land ledgers remain
 * on the debit side and their Cash/Bank counterpart remains on the credit
 * side. No amounts are hardcoded here; balances come from real postings.
 *
 * Run:
 *   npx tsx src/scripts/seed-land-journal-heads.ts
 */

const LAND_GROUP_CODE = "LAND";
const LAND_GROUP_NAME = "Land";

const LAND_HEADS = [
    "LAND AT DHULE",
    "LAND AT KHOPOLI",
    "LAND AT KOLKATA"
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

        const fixedAssets = await tx.ledgerGroup.findUnique({
            where: { code: "FIXED_ASSETS" }
        });

        if (!fixedAssets) {
            throw new Error("FIXED_ASSETS ledger group was not found");
        }

        const landGroup = await tx.ledgerGroup.upsert({
            where: { code: LAND_GROUP_CODE },
            update: {
                name: LAND_GROUP_NAME,
                parentId: fixedAssets.id,
                nature: LedgerNature.DEBIT
            },
            create: {
                code: LAND_GROUP_CODE,
                name: LAND_GROUP_NAME,
                parentId: fixedAssets.id,
                nature: LedgerNature.DEBIT
            }
        });

        let createdHeads = 0;
        let updatedHeads = 0;
        let repairedVouchers = 0;

        for (const name of LAND_HEADS) {
            let journalHead = await tx.journalHead.findFirst({
                where: {
                    name: { equals: name, mode: "insensitive" }
                },
                include: { ledger: true }
            });

            if (!journalHead) {
                const ledger = await tx.ledger.create({
                    data: {
                        code: `LAND-${normalizeCode(name)}`,
                        name,
                        category: LedgerType.JOURNAL,
                        groupId: landGroup.id,
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
                        groupId: landGroup.id,
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
                        `Expected one Land head entry for journal ${journal.id}; found ${headEntry.count}`
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
        }

        return {
            landGroup,
            createdHeads,
            updatedHeads,
            repairedVouchers
        };
    });

    console.log(`Land group ready: ${result.landGroup.name}`);
    console.log(`Journal heads created: ${result.createdHeads}`);
    console.log(`Journal heads updated: ${result.updatedHeads}`);
    console.log(`Existing journal vouchers repaired: ${result.repairedVouchers}`);
    console.log("The Trial Balance Land group will show the cumulative child total.");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());

