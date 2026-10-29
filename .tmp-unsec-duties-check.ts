import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";

(async () => {
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
    const duties = all.filter(x => x.path.startsWith("Current Liabilities > Duties & Taxes"));
    console.log(JSON.stringify({
        duties: duties.map(x => ({
            path: x.path.replace("Current Liabilities > Duties & Taxes", "D&T"),
            oc: x.node.openingCredit, od: x.node.openingDebit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        })),
        sc: all.find(x => x.path === "Current Liabilities > Sundry Creditors")?.node && {
            cd: all.find(x => x.path === "Current Liabilities > Sundry Creditors")!.node.closingDebit,
            cc: all.find(x => x.path === "Current Liabilities > Sundry Creditors")!.node.closingCredit
        },
        od: all.find(x => x.path === "Loans (Liability) > Bank OD A/c & CC A/c")?.node && {
            oc: all.find(x => x.path === "Loans (Liability) > Bank OD A/c & CC A/c")!.node.openingCredit,
            cc: all.find(x => x.path === "Loans (Liability) > Bank OD A/c & CC A/c")!.node.closingCredit
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
