import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

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
        select: { id: true, name: true, branchId: true }
    });
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            voucher: { voucherType: "OPENING_BALANCE" }
        },
        include: { voucher: { select: { branchId: true, voucherDate: true, voucherNo: true } } }
    });
    let dr = 0, cr = 0;
    const branchCounts: Record<string, number> = {};
    let passFilter = 0, failFilter = 0;
    let passDr = 0, passCr = 0;
    for (const e of entries) {
        const amt = cents(e.amount);
        if (e.entryType === "DEBIT") dr += amt; else cr += amt;
        const key = `entry:${e.branchId || "null"}|voucher:${e.voucher.branchId || "null"}`;
        branchCounts[key] = (branchCounts[key] || 0) + 1;
        const passes = e.branchId === BRANCH_ID || (!e.branchId && e.voucher.branchId === BRANCH_ID);
        if (passes) {
            passFilter += 1;
            if (e.entryType === "DEBIT") passDr += amt; else passCr += amt;
        } else failFilter += 1;
    }
    console.log(JSON.stringify({
        ledgers: ledgers.length,
        openingEntries: entries.length,
        openDr: money(dr),
        openCr: money(cr),
        passFilter, failFilter,
        passDr: money(passDr),
        passCr: money(passCr),
        branchCounts,
        sampleFail: entries.filter(e => !(e.branchId === BRANCH_ID || (!e.branchId && e.voucher.branchId === BRANCH_ID))).slice(0, 5).map(e => ({
            ledger: ledgers.find(l => l.id === e.ledgerId)?.name,
            entryBranch: e.branchId,
            voucherBranch: e.voucher.branchId,
            amount: Number(e.amount),
            side: e.entryType
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
