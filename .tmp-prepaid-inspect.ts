import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

const PDF: Record<string, { od: number; oc: number; cd: number; cc: number }> = {
    "CPCB EXPENSES": { od: 0, oc: 0, cd: 3500, cc: 0 },
    "Prepaid Expenses": { od: 168618.57, oc: 0, cd: 157731.29, cc: 0 },
    "Prepaid Insurance": { od: 790379.2, oc: 0, cd: 1159741.62, cc: 0 },
    "Prepaid Licence": { od: 57582.25, oc: 0, cd: 94308.5, cc: 0 },
    "Prepaid License Fees Upto 31.12.30": { od: 143500, oc: 0, cd: 114800, cc: 0 },
};

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "Prepaid", mode: "insensitive" } },
        select: {
            id: true, name: true, code: true,
            parent: { select: { name: true, parent: { select: { name: true } } } },
            ledgers: { select: { id: true, name: true, category: true, isActive: true, openingDebit: true, openingCredit: true } }
        }
    });
    const named = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { contains: "Prepaid", mode: "insensitive" } },
                { name: { contains: "CPCB", mode: "insensitive" } },
            ]
        },
        select: {
            id: true, name: true, category: true, isActive: true, openingDebit: true, openingCredit: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const prepaid = all.filter(x => /Prepaid Exp|CPCB EXPENSES|Prepaid Expenses|Prepaid Insurance|Prepaid Licen/i.test(x.path));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$|Sundry Debtors$/.test(x.path)
    ).map(x => ({
        path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit, cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    const ids = named.map(l => l.id);
    const entries = ids.length ? await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ids },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { ledgerId: true, entryType: true, amount: true, voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } } }
    }) : [];
    const openings = ids.length ? await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ids }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { ledgerId: true, entryType: true, amount: true }
    }) : [];

    console.log(JSON.stringify({
        groups: groups.map(g => ({
            id: g.id, name: g.name, path: `${g.parent?.parent?.name || ""} > ${g.parent?.name || ""} > ${g.name}`,
            ledgers: g.ledgers.map(l => ({ id: l.id, name: l.name, cat: l.category, active: l.isActive, oDr: Number(l.openingDebit || 0), oCr: Number(l.openingCredit || 0) }))
        })),
        named: named.map(l => ({
            id: l.id, name: l.name, cat: l.category, active: l.isActive,
            group: `${l.group?.parent?.name} > ${l.group?.name}`,
            oDr: Number(l.openingDebit || 0), oCr: Number(l.openingCredit || 0)
        })),
        tb: prepaid.map(x => ({
            path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        })),
        pdf: { groupClose: 1530081.41, groupOpen: 1160080.02, children: PDF },
        dbRows: named.map(l => {
            const es = entries.filter(e => e.ledgerId === l.id);
            const os = openings.filter(e => e.ledgerId === l.id);
            const dr = es.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
            const cr = es.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            const oDr = os.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
            const oCr = os.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            return {
                id: l.id, name: l.name, n: es.length, dr: money(dr), cr: money(cr),
                oDr: money(oDr), oCr: money(oCr), close: money(oDr - oCr + dr - cr),
                byType: es.reduce((a: any, e) => {
                    const t = e.voucher.voucherType;
                    a[t] = a[t] || { n: 0, dr: 0, cr: 0 };
                    a[t].n += 1;
                    if (e.entryType === "DEBIT") a[t].dr += Number(e.amount); else a[t].cr += Number(e.amount);
                    return a;
                }, {})
            };
        }),
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
