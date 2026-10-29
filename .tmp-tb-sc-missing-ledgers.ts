import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const START = new Date("2025-03-31T18:30:00.000Z"); // 1 Apr 2025 IST
const END = new Date("2026-03-31T18:29:59.999Z");
const money = (v: number) => Number((v / 100).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const keyName = (v: unknown) => String(v || "").trim().replace(/\s+/g, " ").toUpperCase();

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
    const groupName = new Map(groups.map(g => [g.id, g.name]));
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: {
            id: true, name: true, branchId: true, category: true, isActive: true,
            openingBalanceDate: true, groupId: true
        }
    });
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
    const byLedger = new Map<string, any>();
    for (const l of ledgers) {
        byLedger.set(l.id, {
            ...l, groupName: groupName.get(l.groupId),
            openDr: 0, openCr: 0, perDr: 0, perCr: 0, perDrAfterOpen: 0, perCrAfterOpen: 0
        });
    }
    for (const e of entries) {
        const row = byLedger.get(e.ledgerId);
        if (!row) continue;
        const amt = cents(e.amount);
        const isOpen = e.voucher.voucherType === "OPENING_BALANCE";
        const d = e.voucher.voucherDate;
        if (isOpen) {
            if (e.entryType === "DEBIT") row.openDr += amt; else row.openCr += amt;
            continue;
        }
        if (d >= START && d <= END) {
            if (e.entryType === "DEBIT") row.perDr += amt; else row.perCr += amt;
            const openDate = row.openingBalanceDate;
            const afterOpen = !openDate || d >= openDate;
            if (afterOpen) {
                if (e.entryType === "DEBIT") row.perDrAfterOpen += amt; else row.perCrAfterOpen += amt;
            }
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
        if (n.rowType !== "accountingHeader") leaves.push(n);
        (n.children || []).forEach(walk);
    };
    walk(sc);
    const tbByName = new Map<string, any>();
    for (const n of leaves) {
        const k = keyName(n.name || n.account);
        const cur = tbByName.get(k) || { name: n.name, openDr: 0, openCr: 0, perDr: 0, perCr: 0, closeDr: 0, closeCr: 0, n: 0 };
        cur.openDr += Number(n.openingDebit || 0);
        cur.openCr += Number(n.openingCredit || 0);
        cur.perDr += Number(n.periodDebit || 0);
        cur.perCr += Number(n.periodCredit || 0);
        cur.closeDr += Number(n.closingDebit || 0);
        cur.closeCr += Number(n.closingCredit || 0);
        cur.n += 1;
        tbByName.set(k, cur);
    }

    const dbByName = new Map<string, any>();
    for (const row of byLedger.values()) {
        const k = keyName(row.name);
        const cur = dbByName.get(k) || {
            name: row.name, ids: 0, cats: new Set(), groups: new Set(),
            openDr: 0, openCr: 0, perDr: 0, perCr: 0, perDrAfterOpen: 0, perCrAfterOpen: 0,
            openDates: new Set()
        };
        cur.ids += 1;
        cur.cats.add(row.category);
        cur.groups.add(row.groupName);
        cur.openDr += row.openDr; cur.openCr += row.openCr;
        cur.perDr += row.perDr; cur.perCr += row.perCr;
        cur.perDrAfterOpen += row.perDrAfterOpen; cur.perCrAfterOpen += row.perCrAfterOpen;
        if (row.openingBalanceDate) cur.openDates.add(row.openingBalanceDate.toISOString().slice(0, 10));
        dbByName.set(k, cur);
    }

    const missingFromTb = [];
    const periodMismatch = [];
    let missPerDr = 0, missPerCr = 0, mismatchDr = 0, mismatchCr = 0;
    for (const [k, db] of dbByName) {
        const tb = tbByName.get(k);
        const dbPerDr = money(db.perDr), dbPerCr = money(db.perCr);
        if (!tb) {
            if (db.openDr || db.openCr || db.perDr || db.perCr) {
                missingFromTb.push({
                    name: db.name, ids: db.ids,
                    cats: [...db.cats], groups: [...db.groups],
                    openDr: money(db.openDr), openCr: money(db.openCr),
                    perDr: dbPerDr, perCr: dbPerCr,
                    openDates: [...db.openDates]
                });
                missPerDr += db.perDr; missPerCr += db.perCr;
            }
            continue;
        }
        const dDr = Number((tb.perDr - dbPerDr).toFixed(2));
        const dCr = Number((tb.perCr - dbPerCr).toFixed(2));
        if (dDr !== 0 || dCr !== 0) {
            periodMismatch.push({
                name: db.name, ids: db.ids, tbN: tb.n,
                cats: [...db.cats],
                dbPerDr, dbPerCr, tbPerDr: tb.perDr, tbPerCr: tb.perCr,
                dDr, dCr,
                dbOpenDr: money(db.openDr), dbOpenCr: money(db.openCr),
                tbOpenDr: tb.openDr, tbOpenCr: tb.openCr,
                openDates: [...db.openDates]
            });
            mismatchDr += cents(dDr); mismatchCr += cents(dCr);
        }
    }

    const extraInTb = [];
    for (const [k, tb] of tbByName) {
        if (!dbByName.has(k) && (tb.perDr || tb.perCr || tb.openDr || tb.openCr)) {
            extraInTb.push(tb);
        }
    }

    const dates: Record<string, number> = {};
    for (const l of ledgers) {
        const d = l.openingBalanceDate ? l.openingBalanceDate.toISOString().slice(0, 10) : "null";
        dates[d] = (dates[d] || 0) + 1;
    }

    let afterOpenDr = 0, afterOpenCr = 0, fullDr = 0, fullCr = 0;
    for (const row of byLedger.values()) {
        afterOpenDr += row.perDrAfterOpen; afterOpenCr += row.perCrAfterOpen;
        fullDr += row.perDr; fullCr += row.perCr;
    }

    periodMismatch.sort((a, b) => Math.abs(b.dDr) + Math.abs(b.dCr) - (Math.abs(a.dDr) + Math.abs(a.dCr)));
    missingFromTb.sort((a, b) => (b.perDr + b.perCr) - (a.perDr + a.perCr));

    console.log(JSON.stringify({
        openingDates: dates,
        periodIfCutoffAtOpeningDate: {
            dr: money(afterOpenDr), cr: money(afterOpenCr),
            fullDr: money(fullDr), fullCr: money(fullCr),
            droppedDr: money(fullDr - afterOpenDr), droppedCr: money(fullCr - afterOpenCr)
        },
        missingFromTb: { count: missingFromTb.length, perDr: money(missPerDr), perCr: money(missPerCr), rows: missingFromTb.slice(0, 40) },
        periodMismatch: { count: periodMismatch.length, dDr: money(mismatchDr), dCr: money(mismatchCr), rows: periodMismatch.slice(0, 40) },
        extraInTb: extraInTb.slice(0, 20),
        tbVsPdf: {
            tbPerDr: sc.periodDebit, tbPerCr: sc.periodCredit,
            pdfPerDr: 5486019254.2, pdfPerCr: 5434226296.34,
            gapDr: Number((5486019254.2 - sc.periodDebit).toFixed(2)),
            gapCr: Number((5434226296.34 - sc.periodCredit).toFixed(2))
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
