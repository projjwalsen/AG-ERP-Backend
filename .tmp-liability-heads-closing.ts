import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, { id: string; tallyOpening: number; tallyDebit: number; tallyCredit: number; tallyClosing: number }> = {
    "Sundry Creditors": {
        id: "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
        tallyOpening: 332630278.48,
        tallyDebit: 5486019254.2,
        tallyCredit: 5434226296.34,
        tallyClosing: 280837320.62
    },
    "Advance From S. Debtors": {
        id: "6cfbfae5-9fb5-486b-a317-33d4ab097601",
        tallyOpening: 119225002.2,
        tallyDebit: 1303583400.2,
        tallyCredit: 1458415070.35,
        tallyClosing: 274056672.35
    }
};
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const desc = (root: string) => {
        const ids = new Set([root]);
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
        return [...ids];
    };
    const out: any = {};
    for (const [head, meta] of Object.entries(ROOTS)) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(meta.id) } },
            select: { id: true, name: true, nature: true, openingDebit: true, openingCredit: true, openingBalance: true, currentBalance: true, isActive: true }
        });
        const entries = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: { select: { voucherType: true } } }
            }));
        }
        const movement = entries.filter(e => e.voucher.voucherType !== "OPENING_BALANCE");
        const openingV = entries.filter(e => e.voucher.voucherType === "OPENING_BALANCE");
        const debit = movement.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const credit = movement.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        const openingSigned = openingV.reduce((s, e) => s + (e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount)), 0);
        const openingCredit = -openingSigned;
        const closingSigned = openingSigned + debit - credit;
        const closingCredit = -closingSigned;
        const cached = ledgers.reduce((s, l) => s + cents(l.currentBalance), 0);
        out[head] = {
            ledgers: ledgers.length,
            activeLedgers: ledgers.filter(l => l.isActive).length,
            excelDebit: meta.tallyDebit,
            excelCredit: meta.tallyCredit,
            dbDebit: money(debit),
            dbCredit: money(credit),
            debitMatch: money(debit) === meta.tallyDebit,
            creditMatch: money(credit) === meta.tallyCredit,
            openingCredit: money(openingCredit),
            tallyOpening: meta.tallyOpening,
            openingDiff: money(openingCredit - Math.round(meta.tallyOpening * 100)),
            closingCredit: money(closingCredit),
            tallyClosing: meta.tallyClosing,
            closingDiff: money(closingCredit - Math.round(meta.tallyClosing * 100)),
            cachedCurrentBalanceSum: money(cached)
        };
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
