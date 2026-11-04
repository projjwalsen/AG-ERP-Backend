import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { equals: "Cash", mode: "insensitive" } },
                { name: { contains: "Cash-in-hand", mode: "insensitive" } },
                { name: { contains: "Cash in Hand", mode: "insensitive" } },
                { name: { contains: "Cash-in-Hand", mode: "insensitive" } }
            ]
        },
        select: {
            id: true, name: true, category: true, branchId: true, isActive: true, code: true,
            group: { select: { id: true, name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "Cash", mode: "insensitive" } },
        select: { id: true, name: true, code: true, parent: { select: { name: true } } }
    });
    const heads = await prisma.journalHead.findMany({
        where: { OR: [{ name: { contains: "Cash", mode: "insensitive" } }] },
        select: { id: true, name: true, ledgerId: true, parent: { select: { name: true } }, ledger: { select: { name: true, category: true } } }
    });

    const copies = [];
    for (const l of ledgers) {
        const nPer = await prisma.ledgerEntry.count({
            where: {
                ledgerId: l.id,
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
            }
        });
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: l.id,
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
            },
            select: { entryType: true, amount: true, voucher: { select: { voucherType: true } } }
        });
        const openings = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherType: "OPENING_BALANCE" } },
            select: { entryType: true, amount: true }
        });
        const byType: Record<string, { n: number; dr: number; cr: number }> = {};
        let dr = 0, cr = 0;
        for (const e of entries) {
            const t = e.voucher.voucherType;
            byType[t] = byType[t] || { n: 0, dr: 0, cr: 0 };
            byType[t].n += 1;
            if (e.entryType === "DEBIT") { byType[t].dr += cents(e.amount); dr += cents(e.amount); }
            else { byType[t].cr += cents(e.amount); cr += cents(e.amount); }
        }
        let oDr = 0, oCr = 0;
        for (const e of openings) {
            if (e.entryType === "DEBIT") oDr += cents(e.amount); else oCr += cents(e.amount);
        }
        copies.push({
            id: l.id, name: l.name, cat: l.category, code: l.code, branchId: l.branchId, active: l.isActive,
            path: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`,
            nPer, dr: money(dr), cr: money(cr), oDr: money(oDr), oCr: money(oCr),
            close: money(oDr - oCr + dr - cr),
            byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }]))
        });
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const cash = all.filter(x => /Cash/i.test(x.path) && /Current Assets|Cash/.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Branch \/ Divisions$/.test(x.path)
    ).map(x => ({
        path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit, oc: x.node.openingCredit, od: x.node.openingDebit
    }));

    console.log(JSON.stringify({
        groups, heads, copies,
        pdf: { openDr: 141935, closeDr: 140163.15 },
        cashTb: cash.filter(x => /cash/i.test(x.path)),
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
