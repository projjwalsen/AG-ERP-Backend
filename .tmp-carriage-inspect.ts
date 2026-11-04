import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "Carriage Inward", mode: "insensitive" } },
        select: {
            id: true, name: true, code: true, parentId: true,
            parent: { select: { id: true, name: true, code: true, parent: { select: { name: true } } } }
        }
    });
    const ledgers = await prisma.ledger.findMany({
        where: { name: { contains: "Carriage Inward", mode: "insensitive" } },
        select: {
            id: true, name: true, code: true, isActive: true, category: true, branchId: true, groupId: true,
            openingDebit: true, openingCredit: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { id: true, name: true, parent: { select: { name: true } } } } } }
        }
    });

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const de = all.find(x => x.path === "Direct Expenses")?.node;
    const carriage = all.filter(x => /Carriage Inward/i.test(x.path));

    console.log(JSON.stringify({
        groups,
        ledgers,
        de: de && {
            od: de.openingDebit, oc: de.openingCredit,
            pd: de.periodDebit, pc: de.periodCredit,
            cd: de.closingDebit, cc: de.closingCredit,
            children: (de.children || []).map((c: any) => ({
                name: c.name,
                od: c.openingDebit, oc: c.openingCredit,
                pd: c.periodDebit, pc: c.periodCredit,
                cd: c.closingDebit, cc: c.closingCredit,
                childCount: (c.children || []).length,
                children: (c.children || []).map((x: any) => ({
                    name: x.name, od: x.openingDebit, oc: x.openingCredit,
                    pd: x.periodDebit, pc: x.periodCredit,
                    cd: x.closingDebit, cc: x.closingCredit
                }))
            }))
        },
        carriage: carriage.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            childCount: (x.node.children || []).length
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
