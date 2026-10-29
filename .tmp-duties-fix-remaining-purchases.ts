import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const missing: any[] = JSON.parse(fs.readFileSync(".tmp-duties-gap-ledgers.json", "utf8")).missing;
    const groups = await prisma.ledgerGroup.findMany();
    const byId = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const parts: string[] = [];
        let g = byId.get(id);
        const seen = new Set<string>();
        while (g && !seen.has(g.id)) {
            seen.add(g.id); parts.unshift(g.name);
            g = g.parentId ? byId.get(g.parentId) : undefined;
        }
        return parts.join(" > ");
    };
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const dutiesLedgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true, groupId: true }
    });
    const targetByName = new Map<string, string>();
    for (const l of dutiesLedgers) {
        const k = norm(l.name);
        const nested = pathOf(l.groupId).includes("Duties & Taxes > Duties & Taxes");
        if (!targetByName.has(k) || !nested) targetByName.set(k, l.id);
    }
    const purchaseLedger = await prisma.ledger.findFirst({
        where: { name: "Purchase - AG_ASHTAVINAYAKA_PETROCHEM_MH" },
        select: { id: true }
    });

    const nos = [...new Set(missing.map(r => String(r.no)))];
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: nos } },
        select: { id: true, invoiceNo: true, totalIGSTAmount: true, totalCGSTAmount: true, totalSGSTAmount: true }
    });
    const vouchers = await prisma.voucher.findMany({
        where: { sourceId: { in: purchases.map(p => p.id) }, voucherType: "PURCHASE" },
        select: {
            id: true, sourceId: true, voucherNo: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });

    const added: any[] = [];
    for (const row of missing) {
        const p = purchases.find(x => norm(x.invoiceNo) === norm(row.no));
        const v = p ? vouchers.find(x => x.sourceId === p.id) : undefined;
        const target = targetByName.get(norm(row.name));
        if (!v || !target) {
            added.push({ no: row.no, action: "no-voucher-or-target", name: row.name });
            continue;
        }
        const onVoucher = v.entries.find(e =>
            e.ledgerId === target && e.entryType === row.side && cents(e.amount) === cents(row.amount)
        );
        if (onVoucher) {
            added.push({ no: row.no, action: "already-on-voucher", name: row.name, amount: row.amount });
            continue;
        }
        const purchaseLine = v.entries.find(e => e.ledgerId === purchaseLedger?.id && e.entryType === "DEBIT");
        await prisma.ledgerEntry.create({
            data: {
                voucherId: v.id, ledgerId: target, branchId: BRANCH_ID,
                entryType: row.side, amount: money(row.amount),
                narration: String(row.narration || row.no).slice(0, 400)
            }
        });
        if (purchaseLine && row.side === "DEBIT") {
            const next = money(Number(purchaseLine.amount) - Number(row.amount));
            if (next >= 0) {
                await prisma.ledgerEntry.update({ where: { id: purchaseLine.id }, data: { amount: next } });
                purchaseLine.amount = next as any;
            }
        }
        added.push({ no: row.no, action: "added", name: row.name, amount: row.amount, voucherNo: v.voucherNo });
    }
    console.log(JSON.stringify(added, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
