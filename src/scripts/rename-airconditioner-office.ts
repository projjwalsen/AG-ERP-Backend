import "dotenv/config";
import { prisma } from "../config/db";

const CURRENT_KEY = "AIRCONDITIONEROFFICE";
const TARGET_NAME = "AIR CONDITIONER - OFFICE";
const apply = process.argv.includes("--apply");

function normalize(value: unknown) {
    return String(value || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
}

async function main() {
    const journalHeads = await prisma.journalHead.findMany({
        include: {
            ledger: {
                include: { group: true }
            }
        },
        orderBy: { createdAt: "asc" }
    });

    const matches = journalHeads.filter(head =>
        normalize(head.name) === CURRENT_KEY ||
        normalize(head.ledger.name) === CURRENT_KEY
    );

    const ledgerIds = [...new Set(matches.map(head => head.ledgerId))];

    if (ledgerIds.length !== 1) {
        throw new Error(
            `Expected exactly one AirConditioner Office ledger; found ${ledgerIds.length}. ` +
            "The rename was not applied."
        );
    }

    const ledger = matches[0].ledger;
    const preview = {
        ledger: {
            id: ledger.id,
            oldName: ledger.name,
            newName: TARGET_NAME,
            group: ledger.group.name
        },
        journalHeads: matches.map(head => ({
            id: head.id,
            oldName: head.name,
            newName: TARGET_NAME,
            type: head.type
        })),
        action: apply ? "rename" : "would-rename",
        dryRun: !apply
    };

    if (!apply) {
        console.log(JSON.stringify(preview, null, 2));
        console.log("Dry run only. Re-run with --apply to rename the records.");
        return;
    }

    await prisma.$transaction(async tx => {
        await tx.ledger.update({
            where: { id: ledger.id },
            data: { name: TARGET_NAME }
        });

        await tx.journalHead.updateMany({
            where: { ledgerId: ledger.id },
            data: { name: TARGET_NAME }
        });
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify({
        ...preview,
        dryRun: false
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
