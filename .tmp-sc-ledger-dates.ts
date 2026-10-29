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
        where: { groupId: { in: [...ids] } },
        select: {
            id: true, name: true, branchId: true, isActive: true, category: true,
            openingBalanceDate: true, groupId: true
        }
    });
    const dates: Record<string, number> = {};
    for (const l of ledgers) {
        const d = l.openingBalanceDate ? l.openingBalanceDate.toISOString().slice(0, 10) : "null";
        dates[d] = (dates[d] || 0) + 1;
    }
    console.log(JSON.stringify({
        total: ledgers.length,
        inactive: ledgers.filter(l => !l.isActive).length,
        otherBranch: ledgers.filter(l => l.branchId && l.branchId !== BRANCH_ID).length,
        nullBranch: ledgers.filter(l => !l.branchId).length,
        thisBranch: ledgers.filter(l => l.branchId === BRANCH_ID).length,
        categories: ledgers.reduce((m: any, l) => (m[l.category] = (m[l.category] || 0) + 1, m), {}),
        openingDates: dates
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
