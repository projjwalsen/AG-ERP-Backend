import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const named = groups.filter(g => /sundry creditor/i.test(g.name)).map(g => ({
        id: g.id, name: g.name, code: g.code, parentId: g.parentId
    }));
    const byId = new Map(groups.map(g => [g.id, g]));
    const desc = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                ids.add(g.id); changed = true;
            }
        }
        return [...ids];
    };
    const chain = (id: string) => {
        const out: string[] = [];
        let cur = byId.get(id);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            out.push(cur.name);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return out;
    };
    const out: any = { named: named.map(g => ({ ...g, path: chain(g.id) })) };
    for (const g of named) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(g.id) } },
            select: { id: true, name: true, category: true, openingBalance: true, openingDebit: true, openingCredit: true, currentBalance: true }
        });
        const entries: any[] = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: { select: { voucherType: true } } }
            }));
        }
        let openDr = 0, openCr = 0, moveDr = 0, moveCr = 0, fieldOpen = 0, cache = 0;
        const byLedger = new Map<string, { open: number; move: number }>();
        for (const e of entries) {
            const row = byLedger.get(e.ledgerId) || { open: 0, move: 0 };
            const amt = e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount);
            if (e.voucher.voucherType === "OPENING_BALANCE") row.open += amt;
            else row.move += amt;
            byLedger.set(e.ledgerId, row);
        }
        let closeDr = 0, closeCr = 0;
        for (const l of ledgers) {
            const row = byLedger.get(l.id) || { open: 0, move: 0 };
            if (row.open > 0) openDr += row.open; else openCr += -row.open;
            const move = row.move;
            if (move > 0) moveDr += move; else moveCr += -move;
            const signed = row.open + row.move;
            if (signed > 0) closeDr += signed; else closeCr += -signed;
            fieldOpen += cents(l.openingCredit) - cents(l.openingDebit) || (Number(l.nature === "CREDIT") ? cents(l.openingBalance) : -cents(l.openingBalance));
            cache += cents(l.currentBalance);
        }
        out[g.name + "|" + g.code] = {
            ledgers: ledgers.length,
            categories: ledgers.reduce((m: any, l) => (m[l.category] = (m[l.category] || 0) + 1, m), {}),
            openDr: money(openDr), openCr: money(openCr),
            periodDr: money(moveDr), periodCr: money(moveCr),
            closeDr: money(closeDr), closeCr: money(closeCr),
            netCloseCr: money(closeCr - closeDr),
            pdf: { closeDr: 111541986.01, closeCr: 392379306.63, net: 280837320.62 }
        };
    }
    const others = groups.find(g => /sundry creditors \(others\)/i.test(g.name));
    if (others) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(others.id) } },
            select: { id: true }
        });
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ledgers.map(l => l.id) } },
            include: { voucher: { select: { voucherType: true } } }
        });
        let openDr = 0, openCr = 0, closeDr = 0, closeCr = 0;
        const by = new Map<string, number>();
        for (const e of entries) {
            const amt = e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount);
            by.set(e.ledgerId, (by.get(e.ledgerId) || 0) + amt);
            if (e.voucher.voucherType === "OPENING_BALANCE") {
                if (amt > 0) openDr += amt; else openCr += -amt;
            }
        }
        for (const signed of by.values()) {
            if (signed > 0) closeDr += signed; else closeCr += -signed;
        }
        out.others = {
            id: others.id, path: chain(others.id), ledgers: ledgers.length,
            openDr: money(openDr), openCr: money(openCr),
            closeDr: money(closeDr), closeCr: money(closeCr),
            netCloseCr: money(closeCr - closeDr),
            pdf: { closeDr: 1954466.26, closeCr: 32583551.02, openDr: 879136.01, openCr: 9011248.67 }
        };
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
