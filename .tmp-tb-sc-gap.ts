import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const START = new Date("2025-04-01T00:00:00.000Z");
const END = new Date("2026-03-31T23:59:59.999Z");
const money = (v: number) => Number((v / 100).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const norm = (v: unknown) => String(v || "").trim().replace(/\s+/g, " ").toUpperCase()
    .replace(/\s*-\s*SUNDRY\s+(DEBTOR|CREDITOR)\s*$/i, "");

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
        where: { groupId: { in: [...ids] } },
        select: {
            id: true, name: true, branchId: true, category: true, isActive: true,
            openingBalanceDate: true, openingDebit: true, openingCredit: true, groupId: true
        }
    });
    const customers = await prisma.ledger.findMany({
        where: { category: "CUSTOMER", branchId: BRANCH_ID, isActive: true },
        select: { id: true, name: true, groupId: true, category: true }
    });
    const customerNames = new Set(customers.map(c => norm(c.name)));
    const collisions = ledgers.filter(l =>
        l.category === "JOURNAL" && customerNames.has(norm(l.name))
    );

    const entries = [];
    for (let i = 0; i < ledgers.length; i += 200) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) },
                OR: [
                    { branchId: BRANCH_ID },
                    { branchId: null, voucher: { branchId: BRANCH_ID } }
                ]
            },
            select: {
                ledgerId: true, entryType: true, amount: true,
                voucher: { select: { voucherType: true, voucherDate: true } }
            }
        }));
    }

    let dbOpenDr = 0, dbOpenCr = 0, dbPerDr = 0, dbPerCr = 0;
    const byLedger = new Map<string, { openDr: number; openCr: number; perDr: number; perCr: number }>();
    for (const l of ledgers) byLedger.set(l.id, { openDr: 0, openCr: 0, perDr: 0, perCr: 0 });
    for (const e of entries) {
        const row = byLedger.get(e.ledgerId);
        if (!row) continue;
        const amt = cents(e.amount);
        const isOpen = e.voucher.voucherType === "OPENING_BALANCE";
        const d = e.voucher.voucherDate;
        const inPeriod = d >= START && d <= END;
        if (isOpen) {
            if (e.entryType === "DEBIT") { row.openDr += amt; dbOpenDr += amt; }
            else { row.openCr += amt; dbOpenCr += amt; }
        } else if (inPeriod) {
            if (e.entryType === "DEBIT") { row.perDr += amt; dbPerDr += amt; }
            else { row.perCr += amt; dbPerCr += amt; }
        }
    }

    const collisionAmt = { openDr: 0, openCr: 0, perDr: 0, perCr: 0, names: [] as any[] };
    for (const l of collisions) {
        const row = byLedger.get(l.id)!;
        collisionAmt.openDr += row.openDr;
        collisionAmt.openCr += row.openCr;
        collisionAmt.perDr += row.perDr;
        collisionAmt.perCr += row.perCr;
        if (row.openDr || row.openCr || row.perDr || row.perCr) {
            collisionAmt.names.push({
                name: l.name,
                category: l.category,
                ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, money(v as number)]))
            });
        }
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: "c7feaec8-d19f-480b-8bf3-036745415849", branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const cl = (report.tree || []).find((n: any) => n.name === "Current Liabilities");
    const sc = (cl?.children || []).find((n: any) => n.name === "Sundry Creditors");
    const leaves: any[] = [];
    const walk = (n: any) => {
        const kids = n.children || [];
        if (n.rowType !== "accountingHeader") leaves.push(n);
        kids.forEach(walk);
    };
    walk(sc);

    const ag = leaves.filter((n: any) => /A G ART/i.test(n.name || n.account));
    const tbLeaf = leaves.reduce((a, n) => {
        a.openDr += Number(n.openingDebit || 0);
        a.openCr += Number(n.openingCredit || 0);
        a.perDr += Number(n.periodDebit || 0);
        a.perCr += Number(n.periodCredit || 0);
        a.closeDr += Number(n.closingDebit || 0);
        a.closeCr += Number(n.closingCredit || 0);
        return a;
    }, { openDr: 0, openCr: 0, perDr: 0, perCr: 0, closeDr: 0, closeCr: 0 });

    console.log(JSON.stringify({
        db: {
            ledgers: ledgers.length,
            openDr: money(dbOpenDr), openCr: money(dbOpenCr),
            perDr: money(dbPerDr), perCr: money(dbPerCr)
        },
        tbNode: {
            openDr: sc.openingDebit, openCr: sc.openingCredit,
            perDr: sc.periodDebit, perCr: sc.periodCredit,
            closeDr: sc.closingDebit, closeCr: sc.closingCredit
        },
        tbLeaves: { count: leaves.length, ...tbLeaf },
        pdf: { openDr: 75445285.04, openCr: 408075563.52, perDr: 5486019254.20, perCr: 5434226296.34, closeDr: 111541986.01, closeCr: 392379306.63 },
        collisions: {
            count: collisions.length,
            withActivity: collisionAmt.names.length,
            totals: {
                openDr: money(collisionAmt.openDr),
                openCr: money(collisionAmt.openCr),
                perDr: money(collisionAmt.perDr),
                perCr: money(collisionAmt.perCr)
            },
            names: collisionAmt.names.slice(0, 30)
        },
        agArtTb: ag.map(n => ({
            name: n.name, rowType: n.rowType,
            openDr: n.openingDebit, openCr: n.openingCredit,
            perDr: n.periodDebit, perCr: n.periodCredit,
            closeDr: n.closingDebit, closeCr: n.closingCredit
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
