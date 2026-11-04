import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const norm = (v: unknown) => String(v || "").trim().toUpperCase()
    .replace(/\s*-\s*SUNDRY\s+(DEBTOR|CREDITOR)\s*$/i, "")
    .replace(/\s+/g, " ");

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const groupById = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const parts = [];
        let g = groupById.get(id);
        const seen = new Set();
        while (g && !seen.has(g.id)) {
            seen.add(g.id);
            parts.unshift(g.name);
            g = g.parentId ? groupById.get(g.parentId) : undefined;
        }
        return parts.join(" > ");
    };
    const scLedgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true, branchId: true, category: true, groupId: true }
    });
    const customers = await prisma.ledger.findMany({
        where: { category: "CUSTOMER", isActive: true },
        select: { id: true, name: true, branchId: true, groupId: true }
    });
    const names = ["FALGUNI JAIN", "ARKA PETROCHEM FZC", "A G ART PETROCHEM LLP - CR", "A G ART PETROCHEM LLP"];
    const interesting = [...scLedgers, ...customers].filter(l =>
        names.some(n => norm(l.name).includes(n) || n.includes(norm(l.name)))
    );
    console.log("interesting", interesting.map(l => ({
        name: l.name, cat: (l as any).category, branch: l.branchId, path: pathOf(l.groupId),
        key: `${l.branchId || ""}|${norm(l.name)}`
    })));

    const customerKeys = new Map<string, any[]>();
    for (const c of customers) {
        const k = `${c.branchId || ""}|${norm(c.name)}`;
        customerKeys.set(k, [...(customerKeys.get(k) || []), { name: c.name, path: pathOf(c.groupId), branch: c.branchId }]);
    }
    const folds = [];
    for (const l of scLedgers) {
        if (l.category !== "JOURNAL") continue;
        const k = `${l.branchId || ""}|${norm(l.name)}`;
        const targets = customerKeys.get(k);
        if (targets) folds.push({ journal: l.name, journalPath: pathOf(l.groupId), targets });
    }
    console.log(JSON.stringify({ foldCount: folds.length, folds: folds.slice(0, 40) }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
