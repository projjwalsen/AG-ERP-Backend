import "dotenv/config";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");

async function main() {
    const roundOff = await prisma.ledger.findUnique({
        where: { id: "c2f93e2f-65f8-4355-80f0-fbc41003c48b" },
        select: { id: true, name: true, groupId: true, group: { select: { name: true, parent: { select: { name: true } } } } }
    });
    const purchaseAccounts = await prisma.ledgerGroup.findFirst({
        where: { OR: [{ code: "PURCHASE_ACCOUNTS" }, { name: { equals: "Purchase Accounts", mode: "insensitive" } }], parentId: null }
    });
    console.log(JSON.stringify({ dryRun: !apply, roundOff, purchaseAccounts: purchaseAccounts ? { id: purchaseAccounts.id, name: purchaseAccounts.name, code: purchaseAccounts.code } : null }, null, 2));
    if (!apply) return;
    if (!roundOff || !purchaseAccounts) throw new Error("Round Off ledger or Purchase Accounts group missing");

    await prisma.ledger.update({
        where: { id: roundOff.id },
        data: { groupId: purchaseAccounts.id }
    });
    await LedgerService.syncCachedBalance(prisma, roundOff.id);
    console.log(JSON.stringify({ movedRoundOff: true, from: roundOff.group, to: purchaseAccounts.name }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
