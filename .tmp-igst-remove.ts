import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83fa-46f9-93ec-4517e0eb13bb";
const BRANCH_OK = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const GROUP = "6a3babe6-b50a-4fe5-9d76-995b1a507c4b";
const LEDGER = "7043c5c4-8698-4183-99ff-02bf6c9fe42d";
const INPUT_GST = "d83a0b63-a6ca-46dd-9509-af9ca19c3800";

(async () => {
    await prisma.ledger.update({
        where: { id: LEDGER },
        data: { isActive: false, groupId: INPUT_GST }
    });
    await prisma.ledgerGroup.update({
        where: { id: GROUP },
        data: { parentId: INPUT_GST }
    });

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_OK, startDate: "2025-04-01", endDate: "2026-03-31", includeZero: true }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const caIgst = all.filter(x => /^Current Assets/.test(x.path) && /Input GST IGST/i.test(x.path));
    const duties = all.find(x => x.path === "Current Liabilities > Duties & Taxes");
    const unsec = all.find(x => x.path === "Loans (Liability) > Unsecured Loans");
    const inputGst = all.filter(x => /INPUT GST|Input GST IGST/.test(x.path)).map(x => ({
        path: x.path,
        cd: x.node.closingDebit,
        cc: x.node.closingCredit,
        children: (x.node.children || []).map((c: any) => c.name)
    }));
    const group = await prisma.ledgerGroup.findUnique({
        where: { id: GROUP },
        select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } }
    });
    const ledger = await prisma.ledger.findUnique({
        where: { id: LEDGER },
        select: { isActive: true, name: true, group: { select: { name: true } } }
    });
    console.log(JSON.stringify({
        groupNow: group,
        ledgerNow: ledger,
        stillUnderCurrentAssets: caIgst.map(x => x.path),
        duties: duties && { cd: duties.node.closingDebit, cc: duties.node.closingCredit },
        unsec: unsec && { cc: unsec.node.closingCredit },
        inputGst
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
