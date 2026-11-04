import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const TARGET = { openDr: 4493898.64, openCr: 10561093.14, closeDr: 229972.85, closeCr: 5628516.95 };

(async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: "c7feaec8-d19f-480b-8bf3-036745415849", branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const tree = report.tree || [];
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(tree);
    const dt = all.filter(x => /duties/i.test(x.node.name));
    const cl = all.find(x => x.path === "Current Liabilities");
    const pick = (node: any) => ({
        name: node.name,
        openingDebit: node.openingDebit, openingCredit: node.openingCredit,
        periodDebit: node.periodDebit, periodCredit: node.periodCredit,
        closingDebit: node.closingDebit, closingCredit: node.closingCredit,
        closingBalance: node.closingBalance, closingBalanceType: node.closingBalanceType,
        childNames: (node.children || []).map((c: any) => c.name),
        childCount: (node.children || []).length
    });
    const head = all.find(x => x.path === "Current Liabilities > Duties & Taxes");
    console.log(JSON.stringify({
        dutiesPaths: dt.map(x => ({ path: x.path, ...pick(x.node) })),
        currentLiabilitiesChildren: cl ? (cl.node.children || []).map((c: any) => c.name) : null,
        target: TARGET,
        match: head ? {
            openDr: Number(Number(head.node.openingDebit).toFixed(2)) === TARGET.openDr,
            openCr: Number(Number(head.node.openingCredit).toFixed(2)) === TARGET.openCr,
            closeDr: Number(Number(head.node.closingDebit).toFixed(2)) === TARGET.closeDr,
            closeCr: Number(Number(head.node.closingCredit).toFixed(2)) === TARGET.closeCr
        } : null
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
