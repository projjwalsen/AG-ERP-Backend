import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

(async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: "c7feaec8-d19f-480b-8bf3-036745415849", branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const head = all.find(x => x.path === "Current Liabilities > Duties & Taxes");
    const under = all.filter(x => x.path.startsWith("Current Liabilities > Duties & Taxes"));
    const pick = (n: any) => ({
        name: n.name,
        od: n.openingDebit, oc: n.openingCredit,
        pd: n.periodDebit, pc: n.periodCredit,
        cd: n.closingDebit, cc: n.closingCredit
    });
    console.log(JSON.stringify({
        head: head ? pick(head.node) : null,
        nodes: under.map(x => ({ path: x.path, children: (x.node.children || []).length, ...pick(x.node) }))
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
