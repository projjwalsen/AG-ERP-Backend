import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const named = groups.filter(g => /sundry debtor/i.test(g.name)).map(g => {
        const chain: string[] = [];
        let cur: typeof g | undefined = g;
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            chain.push(cur.name);
            cur = groups.find(x => x.id === cur!.parentId);
        }
        return { id: g.id, name: g.name, code: g.code, parentId: g.parentId, chain };
    });
    const root = named.find(g => g.code === "SUNDRY_DEBTORS") || named.find(g => g.chain[1] === "Current Assets");
    if (!root) throw new Error("Sundry Debtors root not found");
    const ids = new Set([root.id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) {
            if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                ids.add(g.id);
                changed = true;
            }
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: [...ids] } },
        select: { id: true, name: true, isActive: true, currentBalance: true }
    });
    const entries: any[] = [];
    for (let i = 0; i < ledgers.length; i += 200) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
            include: { voucher: { select: { voucherType: true } } }
        }));
    }
    const movement = entries.filter(e => e.voucher.voucherType !== "OPENING_BALANCE");
    const opening = entries.filter(e => e.voucher.voucherType === "OPENING_BALANCE");
    const debit = movement.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
    const credit = movement.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
    const openingSigned = opening.reduce((s, e) => s + (e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount)), 0);
    const tally = { opening: 810264688.8, debit: 5606970974.01, credit: 5760422056.16, closing: 656813606.65 };
    const dbOpeningDebit = openingSigned;
    const dbClosingSigned = openingSigned + debit - credit;
    console.log(JSON.stringify({
        root,
        namedGroups: named,
        ledgers: ledgers.length,
        db: {
            openingDebit: money(dbOpeningDebit),
            debit: money(debit),
            credit: money(credit),
            closingDebit: money(dbClosingSigned)
        },
        tally,
        diff: {
            opening: money(dbOpeningDebit - Math.round(tally.opening * 100)),
            debit: money(debit - Math.round(tally.debit * 100)),
            credit: money(credit - Math.round(tally.credit * 100)),
            closing: money(dbClosingSigned - Math.round(tally.closing * 100))
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
