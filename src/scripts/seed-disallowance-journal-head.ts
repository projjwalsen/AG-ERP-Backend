import "dotenv/config";
import {
    JournalHeadType,
    LedgerNature,
    LedgerType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const HEAD_NAME = "Disallowance";
const LEDGER_CODE = "DISALLOWANCE";

async function main() {
    const result = await prisma.$transaction(async tx => {
        await LedgerService.ensureDefaultLedgerGroups(tx);

        const indirectExpense = await tx.ledgerGroup.findUnique({
            where: { code: "INDIRECT_EXPENSE" }
        });
        if (!indirectExpense) {
            throw new Error("INDIRECT_EXPENSE ledger group was not found");
        }

        const matchingHeads = await tx.journalHead.findMany({
            where: { name: { equals: HEAD_NAME, mode: "insensitive" } },
            include: { ledger: true }
        });
        if (matchingHeads.length > 1) {
            throw new Error(`More than one JournalHead uses the name ${HEAD_NAME}`);
        }

        const existingHead = matchingHeads[0];
        const ledger = existingHead
            ? await tx.ledger.update({
                where: { id: existingHead.ledgerId },
                data: {
                    name: HEAD_NAME,
                    category: LedgerType.JOURNAL,
                    groupId: indirectExpense.id,
                    nature: LedgerNature.DEBIT,
                    isActive: true
                }
            })
            : await LedgerService.getOrCreateLedger(tx, {
                code: LEDGER_CODE,
                name: HEAD_NAME,
                category: LedgerType.JOURNAL,
                groupCode: "INDIRECT_EXPENSE",
                nature: LedgerNature.DEBIT
            });

        const journalHead = existingHead
            ? await tx.journalHead.update({
                where: { id: existingHead.id },
                data: {
                    name: HEAD_NAME,
                    type: JournalHeadType.OUTWARD,
                    isActive: true,
                    ledgerId: ledger.id
                }
            })
            : await tx.journalHead.create({
                data: {
                    name: HEAD_NAME,
                    type: JournalHeadType.OUTWARD,
                    ledgerId: ledger.id
                }
            });

        return { journalHead, ledger };
    });

    console.log(JSON.stringify({
        journalHead: {
            id: result.journalHead.id,
            name: result.journalHead.name,
            type: result.journalHead.type
        },
        ledger: {
            id: result.ledger.id,
            code: result.ledger.code,
            name: result.ledger.name,
            category: result.ledger.category,
            group: "Indirect Expense",
            nature: result.ledger.nature
        },
        note: "No journal voucher or ledger entry was created."
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
