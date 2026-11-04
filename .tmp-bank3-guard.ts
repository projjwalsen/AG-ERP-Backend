import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

(async () => {
    const gone = await prisma.voucher.findMany({
        where: { voucherNo: { in: ["KFD401-CONTRA-20251114", "CB-CONTRA-20260307", "10797", "10807", "8908", "14080"] } },
        select: {
            id: true, voucherNo: true, voucherType: true,
            _count: { select: { entries: true, journals: true } },
            entries: { select: { ledger: { select: { name: true } }, entryType: true, amount: true } }
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
    const adv = all.filter(x => /Advance to S/.test(x.path));
    const duties = all.filter(x => /Duties/.test(x.path) && x.path.split(" > ").length <= 3);
    const loans = all.find(x => x.path === "Current Assets > Loans & Advances (Asset)");
    console.log(JSON.stringify({
        gone: gone.map(v => ({
            no: v.voucherNo, type: v.voucherType, id: v.id,
            entries: v._count.entries, journals: v._count.journals,
            lines: v.entries.map(e => ({ name: e.ledger.name, side: e.entryType, amt: Number(e.amount) }))
        })),
        adv: adv.map(x => ({ path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit, cd: x.node.closingDebit, cc: x.node.closingCredit, children: (x.node.children || []).length })),
        duties: duties.map(x => ({ path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit })),
        loansAdv: loans && { cd: loans.node.closingDebit, cc: loans.node.closingCredit }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
