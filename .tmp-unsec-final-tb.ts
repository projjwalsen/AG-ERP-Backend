import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";
import { prisma } from "./src/config/db";

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
    const pick = (p: string) => {
        const x = all.find(n => n.path === p);
        return x && { oc: x.node.openingCredit, od: x.node.openingDebit, cd: x.node.closingDebit, cc: x.node.closingCredit };
    };
    console.log(JSON.stringify({
        unsec: {
            parent: pick("Loans (Liability) > Unsecured Loans"),
            dir: pick("Loans (Liability) > Unsecured Loans > Loan From Directors"),
            bank: pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank"),
            other: pick("Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank"),
            pdf: {
                parent: { oc: 194220007.32, cc: 209169654.45 },
                dir: { oc: 23586838.62, cc: 21758069.62 },
                bank: { oc: 5669384.98, cc: 86783560.99 },
                other: { oc: 101146121.22, cc: 100628023.84 }
            }
        },
        duties: pick("Current Liabilities > Duties & Taxes"),
        sc: pick("Current Liabilities > Sundry Creditors"),
        odcc: pick("Loans (Liability) > Bank OD A/c & CC A/c"),
        tdsUnsec: pick("Current Liabilities > Duties & Taxes > TDS > TDS ON INTEREST ON UNSECURED LOAN")
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
