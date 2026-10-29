import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const money = (v: number) => Number((v / 100).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

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
        select: { id: true }
    });
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            voucher: { voucherType: { not: "OPENING_BALANCE" } }
        },
        include: { voucher: { select: { branchId: true, voucherType: true } } }
    });
    const by: Record<string, { n: number; dr: number; cr: number }> = {};
    const type: Record<string, { n: number; dr: number; cr: number; pass: number; fail: number }> = {};
    let passDr = 0, passCr = 0, failDr = 0, failCr = 0;
    for (const e of entries) {
        const amt = cents(e.amount);
        const key = `e:${e.branchId || "null"}|v:${e.voucher.branchId || "null"}`;
        by[key] = by[key] || { n: 0, dr: 0, cr: 0 };
        by[key].n += 1;
        if (e.entryType === "DEBIT") by[key].dr += amt; else by[key].cr += amt;
        const t = e.voucher.voucherType;
        type[t] = type[t] || { n: 0, dr: 0, cr: 0, pass: 0, fail: 0 };
        type[t].n += 1;
        if (e.entryType === "DEBIT") type[t].dr += amt; else type[t].cr += amt;
        const pass = e.branchId === BRANCH_ID || (!e.branchId && e.voucher.branchId === BRANCH_ID);
        if (pass) {
            type[t].pass += 1;
            if (e.entryType === "DEBIT") passDr += amt; else passCr += amt;
        } else {
            type[t].fail += 1;
            if (e.entryType === "DEBIT") failDr += amt; else failCr += amt;
        }
    }
    const moneyType: any = {};
    for (const [k, v] of Object.entries(type)) {
        moneyType[k] = { n: v.n, dr: money(v.dr), cr: money(v.cr), pass: v.pass, fail: v.fail };
    }
    console.log(JSON.stringify({
        entries: entries.length,
        passDr: money(passDr), passCr: money(passCr),
        failDr: money(failDr), failCr: money(failCr),
        pdfPeriod: { dr: 5486019254.2, cr: 5434226296.34 },
        tbPeriod: { dr: 5459930341.56, cr: 5405905038.7 },
        branches: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
        types: moneyType
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
