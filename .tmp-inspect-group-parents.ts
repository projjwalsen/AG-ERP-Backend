import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        select: { id: true, code: true, name: true, parentId: true }
    });
    const byId = new Map(groups.map(g => [g.id, g]));
    const path = (id: string) => {
        const names: string[] = [];
        let cur = byId.get(id);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            names.unshift(`${cur.name} [${cur.code}]`);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return names;
    };
    const ids = [
        "ac2dc945-d13c-4116-ac64-a89f7ba5c1e2",
        "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb"
    ];
    const currentLiab = groups.filter(g => /current liabilities/i.test(g.name));
    const liab = groups.filter(g => /^liabilities$/i.test(g.name));
    console.log(JSON.stringify({
        system: path(ids[0]),
        canon: path(ids[1]),
        currentLiabilities: currentLiab.map(g => ({ id: g.id, code: g.code, path: path(g.id) })),
        liabilities: liab.map(g => ({ id: g.id, code: g.code, path: path(g.id) }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
