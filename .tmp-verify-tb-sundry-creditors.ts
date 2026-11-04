import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const PDF = { openDr: 75445285.04, openCr: 408075563.52, closeDr: 111541986.01, closeCr: 392379306.63 };

(async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: "c7feaec8-d19f-480b-8bf3-036745415849", branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const tree = report.tree || report.accountGroups || [];
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(tree);
    const sc = all.filter(x => /sundry creditor/i.test(x.node.name));
    const liab = all.filter(x => /^liabilities$/i.test(x.node.name));
    const currentLiab = all.find(x => x.path === "Current Liabilities");
    const pick = (node: any) => ({
        name: node.name,
        openingDebit: node.openingDebit,
        openingCredit: node.openingCredit,
        periodDebit: node.periodDebit,
        periodCredit: node.periodCredit,
        closingDebit: node.closingDebit,
        closingCredit: node.closingCredit,
        closingBalance: node.closingBalance,
        closingBalanceType: node.closingBalanceType,
        childNames: (node.children || []).map((c: any) => c.name).slice(0, 12),
        childCount: (node.children || []).length
    });
    console.log(JSON.stringify({
        roots: tree.map((n: any) => n.name),
        liabilitiesSections: liab.map(x => x.path),
        sundryCreditorPaths: sc.map(x => ({
            path: x.path,
            ...pick(x.node)
        })),
        currentLiabilities: currentLiab ? pick(currentLiab.node) : null,
        pdf: PDF
    }, null, 2));
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
