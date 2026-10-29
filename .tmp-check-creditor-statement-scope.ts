import "dotenv/config";
import { prisma } from "./src/config/db";

const CANON = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([CANON]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] }, branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb" },
        select: { id: true, name: true, category: true }
    });
    const sample = ledgers.find(l => /ARKA PETROCHEM FZC/i.test(l.name) && !/Sundry/i.test(l.name)) || ledgers[0];
    const heads = await prisma.journalHead.findMany({
        where: { ledgerId: sample.id },
        select: { id: true, name: true }
    });
    const journals = await prisma.journal.findMany({
        where: {
            OR: [
                { journalHeadId: { in: heads.map(h => h.id) } },
                { voucher: { entries: { some: { ledgerId: sample.id } } } }
            ],
            categoryPath: { not: null }
        },
        select: { categoryPath: true },
        take: 20
    });
    const paths = [...new Set(journals.map(j => j.categoryPath).filter(Boolean))];
    let pathJournalCount = 0;
    if (paths.length) {
        pathJournalCount = await prisma.journal.count({
            where: { categoryPath: { in: paths as string[] }, status: "APPROVED" }
        });
    }
    const catCounts = await prisma.ledger.groupBy({
        by: ["category"],
        where: { id: { in: ledgers.map(l => l.id) } },
        _count: { id: true }
    });
    console.log(JSON.stringify({
        sample: sample.name,
        category: sample.category,
        journalHeads: heads.length,
        categoryPaths: paths.slice(0, 10),
        pathJournalCount,
        ledgerCategories: catCounts
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
