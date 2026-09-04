import "dotenv/config";
import { prisma } from "../config/db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter(value => !value.startsWith("--"));
const sourceName = positional[0];
const targetGroupName = positional[1];

function usage() {
    console.log(
        "Dry run: npm run move:journal-head-group -- \"CUSTOM DUTY\" \"Direct Expense\"\n" +
        "Apply:   npm run move:journal-head-group -- \"CUSTOM DUTY\" \"Direct Expense\" --apply"
    );
}

async function main() {
    if (args.includes("--help") || !sourceName || !targetGroupName) {
        usage();
        if (!sourceName || !targetGroupName) process.exitCode = 1;
        return;
    }

    const result = await prisma.$transaction(async tx => {
        const heads = await tx.journalHead.findMany({
            where: {
                name: { equals: sourceName, mode: "insensitive" },
                isActive: true
            },
            include: {
                ledger: {
                    include: { group: true }
                }
            }
        });
        if (heads.length !== 1) {
            throw new Error(
                "Expected exactly one active JournalHead named " +
                sourceName + "; found " + heads.length
            );
        }

        const targetGroups = await tx.ledgerGroup.findMany({
            where: {
                OR: [
                    { name: { equals: targetGroupName, mode: "insensitive" } },
                    { code: targetGroupName.toUpperCase().replace(/\s+/g, "_") }
                ]
            },
            select: { id: true, code: true, name: true, parentId: true }
        });
        if (targetGroups.length !== 1) {
            throw new Error(
                "Expected exactly one target LedgerGroup named/code " +
                targetGroupName + "; found " + targetGroups.length
            );
        }

        const head = heads[0];
        const target = targetGroups[0];
        const preview = {
            journalHead: {
                id: head.id,
                name: head.name,
                ledgerId: head.ledgerId,
                ledgerName: head.ledger.name,
                currentGroup: head.ledger.group.name,
                currentGroupCode: head.ledger.group.code
            },
            targetGroup: target,
            action: apply ? "move-ledger-group" : "would-move-ledger-group"
        };

        if (!apply) return { ...preview, dryRun: true };

        const ledger = await tx.ledger.update({
            where: { id: head.ledgerId },
            data: { groupId: target.id }
        });

        return {
            ...preview,
            ledger: {
                id: ledger.id,
                name: ledger.name,
                groupId: ledger.groupId
            },
            dryRun: false
        };
    });

    console.log(JSON.stringify(result, null, 2));
    if (result.dryRun) {
        console.log("Dry run only. Re-run with --apply to move the ledger.");
    }
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
