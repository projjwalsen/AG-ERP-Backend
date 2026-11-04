import "dotenv/config";
import { prisma } from "./src/config/db";

const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

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
        select: { id: true, name: true, groupId: true }
    });
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            voucher: { voucherType: "OPENING_BALANCE" },
            amount: { in: [225000, 225000.00] as any }
        },
        include: { voucher: { select: { voucherType: true } } }
    });
    const around = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            voucher: { voucherType: "OPENING_BALANCE" }
        }
    });
    const hits = around.filter(e => Math.abs(Number(e.amount) - 225000) < 0.01);
    console.log(JSON.stringify({
        hits: hits.map(e => ({
            name: ledgers.find(l => l.id === e.ledgerId)?.name,
            groupId: ledgers.find(l => l.id === e.ledgerId)?.groupId,
            side: e.entryType,
            amount: Number(e.amount)
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
