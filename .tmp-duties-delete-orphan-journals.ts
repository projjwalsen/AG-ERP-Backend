import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const backup = JSON.parse(fs.readFileSync(".tmp-duties-recon-backup.json", "utf8"));
    const groups = await prisma.ledgerGroup.findMany({ select: { id: true, parentId: true } });
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
        select: { id: true }
    });
    const ledgerIds = ledgers.map(l => l.id);
    const orphans = await prisma.journal.findMany({
        where: {
            voucherId: null,
            status: "APPROVED",
            journalDate: { gte: START, lte: END },
            journalHead: { ledgerId: { in: ledgerIds } }
        },
        select: { id: true, amount: true, direction: true, journalDate: true, journalHead: { select: { ledgerId: true } } }
    });
    let dr = 0, cr = 0;
    for (const j of orphans) {
        if (j.direction === "INWARD") dr += cents(j.amount); else cr += cents(j.amount);
    }
    fs.writeFileSync(".tmp-duties-orphan-journals-backup.json", JSON.stringify({
        count: orphans.length, dr: money(dr), cr: money(cr), ids: orphans.map(j => j.id)
    }));
    const deleteIds = orphans.map(j => j.id);
    for (let i = 0; i < deleteIds.length; i += 500) {
        await prisma.journal.deleteMany({ where: { id: { in: deleteIds.slice(i, i + 500) } } });
    }
    console.log(JSON.stringify({
        backupDeleteVouchers: backup.deleteCount,
        orphanJournals: orphans.length,
        orphanDr: money(dr), orphanCr: money(cr),
        deleted: deleteIds.length
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
