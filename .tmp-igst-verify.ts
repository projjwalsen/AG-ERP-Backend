import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

(async () => {
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
    const ca = all.find(x => x.path === "Current Assets");
    const caChildren = (ca?.node.children || []).map((c: any) => c.name);
    const igst = all.filter(x => /Input GST IGST/i.test(x.path));
    console.log(JSON.stringify({
        currentAssetChildren: caChildren,
        inputGstIgstRows: igst.map(x => x.path),
        duties: (() => {
            const n = all.find(x => x.path === "Current Liabilities > Duties & Taxes")?.node;
            return n && { cd: n.closingDebit, cc: n.closingCredit };
        })()
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
