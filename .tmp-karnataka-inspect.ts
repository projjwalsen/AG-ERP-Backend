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
        where: { name: { contains: "KARNATAKA", mode: "insensitive" } },
        select: {
            id: true, name: true, category: true, branchId: true, isActive: true, groupId: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });
    const karn = ledgers.filter(l => /ASHTAVINAYAKA PETROCHEM.*KARNATAKA/i.test(l.name));
    const ids = karn.map(l => l.id);
    const period = ids.length ? await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ids },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { ledgerId: true, entryType: true, amount: true }
    }) : [];
    const openings = ids.length ? await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ids }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { ledgerId: true, entryType: true, amount: true, voucher: { select: { voucherNo: true, voucherDate: true } } }
    }) : [];
    const byLed: Record<string, any> = {};
    for (const l of karn) byLed[l.id] = { ...l, path: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`, n: 0, dr: 0, cr: 0, oDr: 0, oCr: 0 };
    for (const e of period) {
        const r = byLed[e.ledgerId];
        if (!r) continue;
        r.n += 1;
        if (e.entryType === "DEBIT") r.dr += cents(e.amount); else r.cr += cents(e.amount);
    }
    for (const e of openings) {
        const r = byLed[e.ledgerId];
        if (!r) continue;
        if (e.entryType === "DEBIT") r.oDr += cents(e.amount); else r.oCr += cents(e.amount);
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
    const branchDiv = all.filter(x => /Branch \/ Divisions/.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$/.test(x.path)
    ).map(x => ({
        path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit,
        oc: x.node.openingCredit, od: x.node.openingDebit
    }));

    console.log(JSON.stringify({
        copies: Object.values(byLed).map((r: any) => ({
            id: r.id, name: r.name, cat: r.category, active: r.isActive, branchId: r.branchId,
            path: r.path, n: r.n, dr: money(r.dr), cr: money(r.cr), oDr: money(r.oDr), oCr: money(r.oCr),
            close: money(r.oDr - r.oCr + r.dr - r.cr)
        })),
        pdf: { openCr: 13272543.12, perDr: 389390938.87, perCr: 403559076, closeCr: 27440680.25 },
        branchDiv,
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
