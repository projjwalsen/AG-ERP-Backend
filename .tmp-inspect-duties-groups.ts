import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const byId = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const parts: string[] = [];
        let g = byId.get(id);
        const seen = new Set<string>();
        while (g && !seen.has(g.id)) {
            seen.add(g.id);
            parts.unshift(g.name);
            g = g.parentId ? byId.get(g.parentId) : undefined;
        }
        return parts.join(" > ");
    };
    const duties = groups.filter(g => /duties/i.test(g.name)).map(g => ({
        id: g.id, code: g.code, name: g.name, parentId: g.parentId, path: pathOf(g.id)
    }));
    const descendants = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) {
                if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                    ids.add(g.id); changed = true;
                }
            }
        }
        return ids;
    };

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
    const dt = all.filter(x => /duties/i.test(x.node.name) || /deferred tax/i.test(x.node.name));
    const cl = all.find(x => x.path === "Current Liabilities");
    const pick = (node: any) => ({
        name: node.name, rowType: node.rowType,
        openingDebit: node.openingDebit, openingCredit: node.openingCredit,
        periodDebit: node.periodDebit, periodCredit: node.periodCredit,
        closingDebit: node.closingDebit, closingCredit: node.closingCredit,
        closingBalance: node.closingBalance, closingBalanceType: node.closingBalanceType,
        childNames: (node.children || []).map((c: any) => c.name),
        childCount: (node.children || []).length
    });

    const tallyDt = duties.find(g => g.path === "Current Liabilities > Duties & Taxes") ||
        duties.find(g => /current liabilities/i.test(g.path));
    let db = null;
    if (tallyDt) {
        const ids = descendants(tallyDt.id);
        const ledgers = await prisma.ledger.findMany({
            where: { groupId: { in: [...ids] } },
            select: { id: true, name: true, category: true, isActive: true, branchId: true, groupId: true,
                openingDebit: true, openingCredit: true, openingBalance: true }
        });
        db = {
            group: tallyDt,
            descendantGroups: [...ids].map(id => ({ id, path: pathOf(id) })),
            ledgers: ledgers.map(l => ({
                id: l.id, name: l.name, cat: l.category, active: l.isActive, branch: l.branchId,
                group: pathOf(l.groupId), openDr: Number(l.openingDebit), openCr: Number(l.openingCredit)
            }))
        };
    }

    console.log(JSON.stringify({
        dutiesGroups: duties,
        currentLiabilities: cl ? pick(cl.node) : null,
        dutiesInTb: dt.map(x => ({ path: x.path, ...pick(x.node) })),
        db
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
