import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

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
            select: { id: true, name: true }
        });
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ledgers.map(l => l.id) }, voucher: { voucherType: "OPENING_BALANCE" } },
            include: { voucher: true, ledger: true }
        });
        const byLedger = new Map<string, any[]>();
        for (const e of entries) {
            const a = byLedger.get(e.ledgerId) || [];
            a.push(e);
            byLedger.set(e.ledgerId, a);
        }
        const rows = [...byLedger.entries()].map(([ledgerId, es]) => {
            const net = es.reduce((s, e) => s + (e.entryType === "CREDIT" ? cents(e.amount) : -cents(e.amount)), 0);
            return {
                ledger: es[0].ledger.name,
                count: es.length,
                netCredit: net / 100,
                lines: es.map(e => ({
                    side: e.entryType,
                    amount: cents(e.amount) / 100,
                    no: e.voucher.voucherNo,
                    date: localDate(e.voucher.voucherDate),
                    voucherId: e.voucherId
                }))
            };
        }).sort((a, b) => Math.abs(b.netCredit) - Math.abs(a.netCredit));
        const dups = rows.filter(r => r.count > 1);
        out[head] = {
            openingEntries: entries.length,
            ledgersWithOpening: rows.length,
            totalCredit: rows.reduce((s, r) => s + r.netCredit, 0),
            duplicateLedgers: dups.length,
            duplicateRows: dups.slice(0, 20),
            top: rows.slice(0, 15)
        };
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
