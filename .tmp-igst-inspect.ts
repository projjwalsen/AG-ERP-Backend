import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        where: {
            OR: [
                { name: { contains: "Input GST", mode: "insensitive" } },
                { name: { contains: "IGST", mode: "insensitive" } },
                { code: { contains: "INPUT_GST", mode: "insensitive" } }
            ]
        },
        select: {
            id: true, name: true, code: true, parentId: true, nature: true,
            parent: { select: { id: true, name: true, code: true, parent: { select: { name: true, code: true } } } },
            _count: { select: { ledgers: true, children: true } },
            children: { select: { id: true, name: true, code: true } },
            ledgers: {
                select: { id: true, name: true, isActive: true, branchId: true, category: true },
                take: 30
            }
        }
    });
    const ledgers = await prisma.ledger.findMany({
        where: { name: { contains: "Input GST IGST", mode: "insensitive" } },
        select: {
            id: true, name: true, isActive: true, branchId: true, category: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { name: true, code: true } } } },
            _count: { select: { entries: true } }
        }
    });
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31", includeZero: true }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const hits = all.filter(x => /Input GST|IGST/i.test(x.path));
    console.log(JSON.stringify({
        groups: groups.map(g => ({
            id: g.id, name: g.name, code: g.code, parentId: g.parentId,
            parent: g.parent ? `${g.parent.parent?.name || ""} > ${g.parent.name} (${g.parent.code})` : null,
            ledgerN: g._count.ledgers, childN: g._count.children,
            children: g.children,
            ledgers: g.ledgers
        })),
        ledgers,
        tb: hits.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            children: (x.node.children || []).length
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
