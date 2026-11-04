import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const money = (v: number) => Number((v / 100).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const ist = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

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
        select: { id: true, openingBalance: true, openingDebit: true, openingCredit: true, openingBalanceDate: true, currentBalance: true }
    });
    const entries = [];
    for (let i = 0; i < ledgers.length; i += 200) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
            include: { voucher: { select: { voucherType: true, voucherDate: true, voucherNo: true } } }
        }));
    }
    const fyStart = "2025-04-01";
    const fyEnd = "2026-03-31";
    let before = 0, after = 0, inFy = 0, open = 0;
    let beforeAmt = 0, afterAmt = 0;
    const beforeSamples: any[] = [];
    const afterSamples: any[] = [];
    for (const e of entries) {
        const day = ist(e.voucher.voucherDate);
        const amt = e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount);
        if (e.voucher.voucherType === "OPENING_BALANCE") { open += 1; continue; }
        if (day < fyStart) {
            before += 1; beforeAmt += amt;
            if (beforeSamples.length < 8) beforeSamples.push({ day, no: e.voucher.voucherNo, type: e.voucher.voucherType, amt: money(amt) });
        } else if (day > fyEnd) {
            after += 1; afterAmt += amt;
            if (afterSamples.length < 8) afterSamples.push({ day, no: e.voucher.voucherNo, type: e.voucher.voucherType, amt: money(amt) });
        } else inFy += 1;
    }
    const fieldOpen = ledgers.reduce((s, l) => s + cents(l.openingDebit) + cents(l.openingCredit) + cents(l.openingBalance), 0);
    const cache = ledgers.reduce((s, l) => s + cents(l.currentBalance), 0);
    console.log(JSON.stringify({
        ledgers: ledgers.length,
        entries: entries.length,
        openingVouchers: open,
        inFy,
        beforeFy: { count: before, net: money(beforeAmt), samples: beforeSamples },
        afterFy: { count: after, net: money(afterAmt), samples: afterSamples },
        ledgerFieldOpeningsNonzero: ledgers.filter(l => Number(l.openingDebit) || Number(l.openingCredit) || Number(l.openingBalance)).length,
        fieldOpenSumAbs: money(fieldOpen),
        currentBalanceSum: money(cache)
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
