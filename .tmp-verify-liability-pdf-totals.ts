import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, any> = {
    "Sundry Creditors": {
        id: "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
        pdf: { openDr: 75445285.04, openCr: 408075563.52, closeDr: 111541986.01, closeCr: 392379306.63 },
        period: { debit: 5486019254.2, credit: 5434226296.34 }
    },
    "Advance From S. Debtors": {
        id: "6cfbfae5-9fb5-486b-a317-33d4ab097601",
        pdf: { openDr: 20422162.8, openCr: 139647165, closeDr: 0, closeCr: 274056672.35 },
        period: { debit: 1303583400.2, credit: 1458415070.35 }
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
            for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); changed = true; }
        }
        return [...ids];
    };
    const out: any = {};
    for (const [head, meta] of Object.entries(ROOTS)) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(meta.id) } },
            select: { id: true, name: true }
        });
        const entries: any[] = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: { select: { voucherType: true } } }
            }));
        }
        const byLedger = new Map<string, { openDr: number; openCr: number; moveDr: number; moveCr: number }>();
        for (const e of entries) {
            const row = byLedger.get(e.ledgerId) || { openDr: 0, openCr: 0, moveDr: 0, moveCr: 0 };
            const amount = cents(e.amount);
            if (e.voucher.voucherType === "OPENING_BALANCE") {
                if (e.entryType === "DEBIT") row.openDr += amount;
                else row.openCr += amount;
            } else {
                if (e.entryType === "DEBIT") row.moveDr += amount;
                else row.moveCr += amount;
            }
            byLedger.set(e.ledgerId, row);
        }
        let openDr = 0, openCr = 0, moveDr = 0, moveCr = 0, closeDr = 0, closeCr = 0;
        for (const row of byLedger.values()) {
            openDr += row.openDr;
            openCr += row.openCr;
            moveDr += row.moveDr;
            moveCr += row.moveCr;
            const signed = (row.openDr - row.openCr) + row.moveDr - row.moveCr;
            if (signed > 0) closeDr += signed;
            else closeCr += -signed;
        }
        out[head] = {
            db: {
                openingDebit: money(openDr),
                openingCredit: money(openCr),
                periodDebit: money(moveDr),
                periodCredit: money(moveCr),
                closingDebit: money(closeDr),
                closingCredit: money(closeCr),
                netOpeningCredit: money(openCr - openDr),
                netClosingCredit: money(closeCr - closeDr)
            },
            pdf: {
                openingDebit: meta.pdf.openDr,
                openingCredit: meta.pdf.openCr,
                closingDebit: meta.pdf.closeDr,
                closingCredit: meta.pdf.closeCr,
                netOpeningCredit: Number((meta.pdf.openCr - meta.pdf.openDr).toFixed(2)),
                netClosingCredit: Number((meta.pdf.closeCr - meta.pdf.closeDr).toFixed(2))
            },
            match: {
                openingDebit: money(openDr) === meta.pdf.openDr,
                openingCredit: money(openCr) === meta.pdf.openCr,
                periodDebit: money(moveDr) === meta.period.debit,
                periodCredit: money(moveCr) === meta.period.credit,
                closingDebit: money(closeDr) === meta.pdf.closeDr,
                closingCredit: money(closeCr) === meta.pdf.closeCr
            }
        };
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
