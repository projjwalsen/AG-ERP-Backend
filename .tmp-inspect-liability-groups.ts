import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const byId = new Map(groups.map(g => [g.id, g]));
    const chain = (id: string) => {
        const out: any[] = [];
        let cur = byId.get(id);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            out.push({ id: cur.id, name: cur.name, code: cur.code, parentId: cur.parentId });
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return out;
    };
    const ids = [
        "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
        "6cfbfae5-9fb5-486b-a317-33d4ab097601",
        "ac2dc945-d13c-4116-ac64-a89f7ba5c1e2",
        "1572cc63-75cf-452f-913a-830a3b7256bf"
    ];
    const named = groups.filter(g =>
        /sundry|advance from/i.test(g.name)
    ).map(g => ({ ...chain(g.id)[0], parent: chain(g.id).slice(1).map(x => x.name) }));

    const audit = JSON.parse(fs.readFileSync(".tmp-reconcile-liability-heads-audit.json", "utf8"));
    const elsewhereGroups = new Map<string, number>();
    for (const x of audit.classified.exactElsewhere) {
        for (const h of x.hits) {
            elsewhereGroups.set(h.groupId, (elsewhereGroups.get(h.groupId) || 0) + 1);
        }
    }
    const extra = audit.extra;
    const same = audit.classified.sameNoTypeWrong;
    const blank = audit.classified.blankNo;
    const uniqueEntryIds = new Set(audit.classified.exactElsewhere.flatMap((x: any) => x.hits.map((h: any) => h.entryId)));
    const uniqueLedgerIds = new Set(audit.classified.exactElsewhere.flatMap((x: any) => x.hits.map((h: any) => h.ledgerId)));

    console.log(JSON.stringify({
        namedGroups: named,
        requestedChains: Object.fromEntries(ids.map(id => [id, chain(id)])),
        elsewhereGroups: [...elsewhereGroups.entries()].map(([id, n]) => ({ id, n, chain: chain(id) })),
        uniqueElsewhereEntries: uniqueEntryIds.size,
        uniqueElsewhereLedgers: uniqueLedgerIds.size,
        exactElsewhere: audit.classified.exactElsewhere.length,
        multiHit: audit.classified.exactElsewhere.filter((x: any) => x.hits.length > 1).length,
        sameCount: same.length,
        same,
        extra,
        blank
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
