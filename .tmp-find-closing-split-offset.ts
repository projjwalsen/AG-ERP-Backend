import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v ?? "").normalize("NFKD").replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const desc = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); changed = true; }
        }
        return [...ids];
    };
    const out: any = {};
    for (const [head, id] of Object.entries(ROOTS)) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(id) } },
            select: { id: true, name: true, groupId: true, isActive: true }
        });
        const entries: any[] = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: { select: { voucherType: true, voucherNo: true } } }
            }));
        }
        const rows = ledgers.map(l => {
            const mine = entries.filter(e => e.ledgerId === l.id);
            const open = mine.filter(e => e.voucher.voucherType === "OPENING_BALANCE")
                .reduce((s, e) => s + (e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount)), 0);
            const move = mine.filter(e => e.voucher.voucherType !== "OPENING_BALANCE")
                .reduce((s, e) => s + (e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount)), 0);
            return {
                id: l.id,
                name: l.name,
                groupId: l.groupId,
                entries: mine.length,
                openings: mine.filter(e => e.voucher.voucherType === "OPENING_BALANCE").length,
                signed: open + move,
                closeDr: Math.max(open + move, 0),
                closeCr: Math.max(-(open + move), 0)
            };
        }).filter(r => r.signed !== 0);
        const byName = new Map<string, typeof rows>();
        for (const r of rows) {
            const k = norm(r.name);
            const a = byName.get(k) || [];
            a.push(r);
            byName.set(k, a);
        }
        const dups = [...byName.entries()].filter(([, a]) => a.length > 1).map(([k, a]) => ({
            name: k,
            ledgers: a.map(x => ({ id: x.id, name: x.name, entries: x.entries, openings: x.openings, close: money(x.signed) }))
        }));
        out[head] = {
            debitClosers: rows.filter(r => r.closeDr).sort((a, b) => b.closeDr - a.closeDr).slice(0, 12).map(r => ({
                name: r.name, id: r.id, entries: r.entries, openings: r.openings, closeDr: money(r.closeDr)
            })),
            creditClosersTop: rows.filter(r => r.closeCr).sort((a, b) => b.closeCr - a.closeCr).slice(0, 5).map(r => ({
                name: r.name, closeCr: money(r.closeCr), entries: r.entries, openings: r.openings
            })),
            duplicateNamesWithBalance: dups,
            debitCloserCount: rows.filter(r => r.closeDr).length,
            creditCloserCount: rows.filter(r => r.closeCr).length
        };
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
