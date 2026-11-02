import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const NAMES = [
    "Salary & Wages",
    "Anil Menda Salary",
    "Prarthana Anil Menda Salary",
    "Vanishka Anil Menda Salary",
    "Ineligible ITC 17(5) -CGST",
    "Ineligible ITC 17(5) -SGST",
    "Ineligible ITC 17(5) -IGST",
    "L&T Finance Holdings Limited. BL231224040100133",
    "TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE",
    "CGST ITC Not Reflected in GSTR-2B",
    "SGST ITC Not Reflected in GSTR-2B"
];
const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

(async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const tb = all.filter(x => NAMES.some(n => x.node.name.toLowerCase() === n.toLowerCase()))
        .map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            childCount: (x.node.children || []).length
        }));

    const vouchers = await prisma.voucher.findMany({
        where: { voucherNo: { in: ["17", "38", "53", "71"] }, branchId: BRANCH },
        include: {
            entries: { include: { ledger: { select: { name: true } } } },
            journals: { select: { id: true, status: true, amount: true } }
        }
    });
    const salaryRelated = vouchers.filter(v =>
        v.entries.some(e => /menda salary|salary & wages/i.test(e.ledger.name))
    ).map(v => ({
        id: v.id, no: v.voucherNo, type: v.voucherType, date: v.voucherDate,
        narr: v.narration, journals: v.journals,
        entries: v.entries.map(e => ({
            id: e.id, side: e.entryType, amt: Number(e.amount), ledger: e.ledger.name, branchId: e.branchId
        }))
    }));

    const inel = await prisma.ledger.findMany({
        where: { name: { contains: "Ineligible ITC 17(5)", mode: "insensitive" } },
        select: { id: true, name: true, isActive: true, branchId: true, group: { select: { name: true, parent: { select: { name: true } } } } }
    });

    console.log(JSON.stringify({ tb, salaryRelated, inel }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
