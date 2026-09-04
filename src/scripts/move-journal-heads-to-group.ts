import "dotenv/config";
import { LedgerNature } from "@prisma/client";
import { prisma } from "../config/db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter(value => !value.startsWith("--"));

function splitNames(value: string | undefined) {
    return String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function groupCode(value: string) {
    return value
        .toUpperCase()
        .replace(/&/g, " AND ")
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}

function usage() {
    console.log(
        "Dry run:\n" +
        "npm run move:journal-heads-to-group -- " +
        "\"Custom Duty,Import clearing & forwarding expenses\" " +
        "\"Import clearing expenses,Direct Expense\"\n\n" +
        "Apply:\n" +
        "npm run move:journal-heads-to-group -- " +
        "\"Custom Duty,Import clearing & forwarding expenses\" " +
        "\"Import clearing expenses,Direct Expense\" --apply"
    );
}

async function main() {
    if (args.includes("--help") || positional.length < 2) {
        usage();
        if (positional.length < 2) process.exitCode = 1;
        return;
    }

    const sourceNames = splitNames(positional[0]);
    const groupPath = splitNames(positional[1]);
    const targetGroupName = groupPath[0];
    const parentGroupName = groupPath[1];

    if (!sourceNames.length || !targetGroupName || !parentGroupName) {
        throw new Error(
            "Use comma-separated source JournalHead names and target,parent group names"
        );
    }

    const result = await prisma.$transaction(async tx => {
        const heads: any[] = [];
        for (const sourceName of sourceNames) {
            const matches = await tx.journalHead.findMany({
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
            if (matches.length !== 1) {
                throw new Error(
                    "Expected exactly one active JournalHead named " +
                    sourceName + "; found " + matches.length
                );
            }
            heads.push(matches[0]);
        }

        const parentMatches = await tx.ledgerGroup.findMany({
            where: {
                OR: [
                    { name: { equals: parentGroupName, mode: "insensitive" } },
                    { code: groupCode(parentGroupName) }
                ]
            },
            select: { id: true, code: true, name: true, parentId: true, nature: true }
        });
        if (parentMatches.length !== 1) {
            throw new Error(
                "Expected exactly one parent LedgerGroup named/code " +
                parentGroupName + "; found " + parentMatches.length
            );
        }
        const parentGroup = parentMatches[0];

        const targetCode = groupCode(targetGroupName);
        const targetMatches = await tx.ledgerGroup.findMany({
            where: {
                OR: [
                    { name: { equals: targetGroupName, mode: "insensitive" } },
                    { code: targetCode }
                ]
            },
            select: { id: true, code: true, name: true, parentId: true, nature: true }
        });
        if (targetMatches.length > 1) {
            throw new Error(
                "More than one LedgerGroup matches " + targetGroupName
            );
        }
        const existingTarget = targetMatches[0];
        if (existingTarget?.id === parentGroup.id) {
            throw new Error("Target group cannot be the same as its parent group");
        }

        const preview = {
            sourceHeads: heads.map(head => ({
                id: head.id,
                name: head.name,
                ledgerId: head.ledgerId,
                ledgerName: head.ledger.name,
                currentGroup: head.ledger.group.name,
                currentGroupCode: head.ledger.group.code
            })),
            targetGroup: existingTarget || {
                id: null,
                code: targetCode,
                name: targetGroupName,
                parentId: parentGroup.id,
                nature: LedgerNature.DEBIT,
                action: "would-create"
            },
            parentGroup,
            action: apply ? "move-journal-head-ledgers" : "would-move-journal-head-ledgers"
        };

        if (!apply) return { ...preview, dryRun: true };

        const targetGroup = existingTarget
            ? await tx.ledgerGroup.update({
                where: { id: existingTarget.id },
                data: {
                    name: targetGroupName,
                    parentId: parentGroup.id,
                    nature: LedgerNature.DEBIT
                },
                select: { id: true, code: true, name: true, parentId: true, nature: true }
            })
            : await tx.ledgerGroup.create({
                data: {
                    code: targetCode,
                    name: targetGroupName,
                    parentId: parentGroup.id,
                    nature: LedgerNature.DEBIT
                },
                select: { id: true, code: true, name: true, parentId: true, nature: true }
            });

        const moved = [];
        for (const head of heads) {
            const ledger = await tx.ledger.update({
                where: { id: head.ledgerId },
                data: { groupId: targetGroup.id },
                select: { id: true, name: true, groupId: true }
            });
            moved.push({
                journalHead: head.name,
                ledgerId: ledger.id,
                ledgerName: ledger.name,
                groupId: ledger.groupId
            });
        }

        return {
            ...preview,
            targetGroup,
            moved,
            dryRun: false
        };
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify(result, null, 2));
    if (result.dryRun) {
        console.log("Dry run only. Re-run with --apply to make the move.");
    }
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
