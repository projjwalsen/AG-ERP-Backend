import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: [...ids] } },
        select: { id: true, name: true }
    });
    const journals = await prisma.journal.findMany({
        where: {
            voucherId: null,
            status: "APPROVED",
            journalHead: { ledgerId: { in: ledgers.map(l => l.id) } }
        },
        include: {
            journalHead: { select: { id: true, name: true, ledgerId: true, type: true } }
        }
    });
    console.log(JSON.stringify(journals.map(j => ({
        id: j.id,
        date: j.journalDate,
        amount: Number(j.amount),
        direction: j.direction,
        headType: j.journalHead.type,
        head: j.journalHead.name,
        ledgerId: j.journalHead.ledgerId,
        ledger: ledgers.find(l => l.id === j.journalHead.ledgerId)?.name,
        voucherNo: j.voucherNo,
        importKey: j.importKey,
        remarks: j.remarks,
        categoryPath: j.categoryPath,
        serialNo: j.serialNo,
        sourceSheet: j.sourceSheet,
        sourceRow: j.sourceRow
    })), null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
