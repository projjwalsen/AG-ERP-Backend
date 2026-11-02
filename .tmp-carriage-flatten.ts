import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const URD_CANON = "e6ffe590-2757-4b30-94f1-278a55024501";
const URD_GROUP = "fefad64c-3c6f-4f1e-aaed-1be188a8ec20";
const RD_CANON = "1212a65a-f7d5-4ce8-a578-2552e8fa5d0f";
const RD_GROUP = "5c6a3881-c03e-4571-9cb1-6084deab7a07";

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

const amounts = (n: any) => n && ({
    od: n.openingDebit, oc: n.openingCredit,
    pd: n.periodDebit, pc: n.periodCredit,
    cd: n.closingDebit, cc: n.closingCredit
});

(async () => {
    const urd = await prisma.ledger.findUnique({ where: { id: URD_CANON }, select: { name: true, groupId: true } });
    const rd = await prisma.ledger.findUnique({ where: { id: RD_CANON }, select: { name: true, groupId: true } });
    if (urd?.name !== "Carriage Inward URD") throw new Error(`URD name ${urd?.name}`);
    if (rd?.name !== "Carriage Inwards RD") throw new Error(`RD name ${rd?.name}`);

    await prisma.ledger.update({ where: { id: URD_CANON }, data: { groupId: URD_GROUP } });
    await prisma.ledger.update({ where: { id: RD_CANON }, data: { groupId: RD_GROUP } });

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const de = all.find(x => x.path === "Direct Expenses")?.node;
    console.log(JSON.stringify({
        de: amounts(de),
        children: (de?.children || []).map((c: any) => ({
            name: c.name, ...amounts(c), childCount: (c.children || []).length
        })),
        carriage: all.filter(x => /Carriage Inward/i.test(x.path)).map(x => ({
            path: x.path, ...amounts(x.node), childCount: (x.node.children || []).length
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
