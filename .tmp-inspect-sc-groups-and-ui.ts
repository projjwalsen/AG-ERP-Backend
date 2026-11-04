import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "Sundry Creditor", mode: "insensitive" } },
        select: { id: true, code: true, name: true, parentId: true }
    });
    const byId = new Map((await prisma.ledgerGroup.findMany()).map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const names: string[] = [];
        let cur = byId.get(id);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            names.unshift(cur.name);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return names.join(" > ");
    };
    const descendants = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of byId.values()) {
                if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                    ids.add(g.id); changed = true;
                }
            }
        }
        return [...ids];
    };
    const out: any[] = [];
    for (const g of groups) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: descendants(g.id) } },
            select: { id: true, name: true, category: true }
        });
        const entries: any[] = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: { select: { voucherType: true } } }
            }));
        }
        const byLedger = new Map<string, number>();
        let openDr = 0, openCr = 0, moveDr = 0, moveCr = 0;
        for (const e of entries) {
            const signed = e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount);
            if (e.voucher.voucherType === "OPENING_BALANCE") {
                if (signed > 0) openDr += signed; else openCr += -signed;
            } else if (signed > 0) moveDr += signed; else moveCr += -signed;
            byLedger.set(e.ledgerId, (byLedger.get(e.ledgerId) || 0) + signed);
        }
        let closeDr = 0, closeCr = 0;
        for (const s of byLedger.values()) {
            if (s > 0) closeDr += s; else closeCr += -s;
        }
        out.push({
            id: g.id, code: g.code, name: g.name, path: pathOf(g.id),
            ledgers: ledgers.length,
            categories: [...new Set(ledgers.map(l => l.category))],
            openingDebit: money(openDr), openingCredit: money(openCr),
            periodDebit: money(moveDr), periodCredit: money(moveCr),
            closingDebit: money(closeDr), closingCredit: money(closeCr),
            netClosingCredit: money(closeCr - closeDr)
        });
    }

    const vendors = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, category: "VENDOR" },
        select: { id: true, name: true, groupId: true }
    });
    const vendorEntries: any[] = [];
    for (let i = 0; i < vendors.length; i += 200) {
        vendorEntries.push(...await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: vendors.slice(i, i + 200).map(l => l.id) } },
            include: { voucher: { select: { voucherType: true } } }
        }));
    }
    const vBy = new Map<string, number>();
    for (const e of vendorEntries) {
        const signed = e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount);
        vBy.set(e.ledgerId, (vBy.get(e.ledgerId) || 0) + signed);
    }
    let vDr = 0, vCr = 0;
    for (const s of vBy.values()) if (s > 0) vDr += s; else vCr += -s;

    console.log(JSON.stringify({
        groups: out,
        allVendorLedgers: {
            count: vendors.length,
            closingDebit: money(vDr),
            closingCredit: money(vCr),
            netClosingCredit: money(vCr - vDr)
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
