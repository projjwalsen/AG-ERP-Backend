import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const heading = (n: string) => String(n || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        select: { id: true, code: true, name: true, parentId: true }
    });
    const byId = new Map(groups.map(g => [g.id, g]));
    const childrenOf = (id: string) => groups.filter(g => g.parentId === id);
    const path = (id: string) => {
        const names: string[] = [];
        let cur = byId.get(id);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            names.unshift(cur.name);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return names.join(" > ");
    };

    const interesting = groups.filter(g =>
        /sundry creditor|current liab|liabilities/i.test(g.name)
    );
    const out: any[] = [];
    for (const g of interesting) {
        const kids = childrenOf(g.id);
        const ledgerCount = await prisma.ledger.count({
            where: { groupId: g.id, branchId: BRANCH_ID }
        });
        const namedCurrentLiab = await prisma.ledger.findMany({
            where: { groupId: g.id, name: { contains: "Current Liab", mode: "insensitive" } },
            select: { id: true, name: true, category: true }
        });
        const namedSC = await prisma.ledger.findMany({
            where: { groupId: g.id, name: { equals: "Sundry Creditors", mode: "insensitive" } },
            select: { id: true, name: true, category: true }
        });
        out.push({
            id: g.id, code: g.code, name: g.name, path: path(g.id),
            children: kids.map(k => `${k.name} [${k.code}]`),
            directLedgers: ledgerCount,
            ledgersNamedCurrentLiabilities: namedCurrentLiab,
            ledgersNamedSundryCreditors: namedSC
        });
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
