import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const NAMES = [
    "Salary & Wages",
    "Anil Menda Salary",
    "Prarthana Anil Menda Salary",
    "Vanishka Anil Menda Salary",
    "Vqanishka Anil Menda Salary",
    "Ineligible ITC 17(5) -CGST",
    "Ineligible ITC 17(5) -SGST",
    "Ineligible ITC 17(5) -IGST",
    "L&T Finance Holdings Limited. BL231224040100133",
    "TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE",
    "CGST ITC Not Reflected in GSTR-2B",
    "SGST ITC Not Reflected in GSTR-2B"
];
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: NAMES.map(n => ({ name: { equals: n, mode: "insensitive" as const } }))
        },
        select: {
            id: true, name: true, code: true, isActive: true, category: true, branchId: true, groupId: true,
            openingDebit: true, openingCredit: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });

    const details = [];
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: l.id,
                voucher: { voucherDate: { gte: START, lte: END } }
            },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true } }
            }
        });
        const dr = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0);
        const cr = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0);
        details.push({
            id: l.id, name: l.name, active: l.isActive, cat: l.category, branchId: l.branchId,
            group: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`,
            n: entries.length,
            dr: Number(dr.toFixed(2)), cr: Number(cr.toFixed(2)),
            types: [...new Set(entries.map(e => e.voucher.voucherType))],
            nos: [...new Set(entries.map(e => e.voucher.voucherNo))].sort()
        });
    }

    const salaryCanon = ledgers.filter(l => /menda salary|salary & wages/i.test(l.name) && l.isActive);
    const salaryVouchers = [];
    for (const l of salaryCanon) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherDate: { gte: START, lte: END } } },
            select: {
                entryType: true, amount: true,
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, narration: true } }
            },
            orderBy: { voucher: { voucherDate: "asc" } }
        });
        salaryVouchers.push({
            name: l.name,
            rows: entries.map(e => ({
                date: localDate(e.voucher.voucherDate),
                no: e.voucher.voucherNo,
                type: e.voucher.voucherType,
                side: e.entryType,
                amt: Number(e.amount)
            }))
        });
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const tb = [];
    for (const n of NAMES) {
        const hits = all.filter(x => x.node.name.toLowerCase() === n.toLowerCase());
        tb.push(...hits.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            childCount: (x.node.children || []).length
        })));
    }

    console.log(JSON.stringify({ ledgers: details, tb, salaryVouchers }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
